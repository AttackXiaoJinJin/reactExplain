/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable no-var */

import {enableSchedulerDebugging} from './SchedulerFeatureFlags';
import {
  requestHostCallback,
  requestHostTimeout,
  cancelHostTimeout,
  shouldYieldToHost,
  getCurrentTime,
  forceFrameRate,
  requestPaint,
} from './SchedulerHostConfig';

// TODO: Use symbols?
var ImmediatePriority = 1;
var UserBlockingPriority = 2;
var NormalPriority = 3;
var LowPriority = 4;
var IdlePriority = 5;

// Max 31 bit integer. The max integer size in V8 for 32-bit systems.
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;

// Times out immediately
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// Eventually times out
var USER_BLOCKING_PRIORITY = 250;
var NORMAL_PRIORITY_TIMEOUT = 5000;
var LOW_PRIORITY_TIMEOUT = 10000;
// Never times out
var IDLE_PRIORITY = maxSigned31BitInt;

// Tasks are stored as a circular, doubly linked list.
var firstTask = null;
var firstDelayedTask = null;

// Pausing the scheduler is useful for debugging.
var isSchedulerPaused = false;

var currentTask = null;
var currentPriorityLevel = NormalPriority;

// This is set while performing work, to prevent re-entrancy.
var isPerformingWork = false;

var isHostCallbackScheduled = false;
var isHostTimeoutScheduled = false;

function flushTask(task, currentTime) {
  // Remove the task from the list before calling the callback. That way the
  // list is in a consistent state even if the callback throws.
  const next = task.next;
  if (next === task) {
    // This is the only scheduled task. Clear the list.
    firstTask = null;
  } else {
    // Remove the task from its position in the list.
    if (task === firstTask) {
      firstTask = next;
    }
    const previous = task.previous;
    previous.next = next;
    next.previous = previous;
  }
  task.next = task.previous = null;

  // Now it's safe to execute the task.
  var callback = task.callback;
  var previousPriorityLevel = currentPriorityLevel;
  var previousTask = currentTask;
  currentPriorityLevel = task.priorityLevel;
  currentTask = task;
  var continuationCallback;
  try {
    var didUserCallbackTimeout = task.expirationTime <= currentTime;
    continuationCallback = callback(didUserCallbackTimeout);
  } catch (error) {
    throw error;
  } finally {
    currentPriorityLevel = previousPriorityLevel;
    currentTask = previousTask;
  }

  // A callback may return a continuation. The continuation should be scheduled
  // with the same priority and expiration as the just-finished callback.
  if (typeof continuationCallback === 'function') {
    var expirationTime = task.expirationTime;
    var continuationTask = {
      callback: continuationCallback,
      priorityLevel: task.priorityLevel,
      startTime: task.startTime,
      expirationTime,
      next: null,
      previous: null,
    };

    // Insert the new callback into the list, sorted by its timeout. This is
    // almost the same as the code in `scheduleCallback`, except the callback
    // is inserted into the list *before* callbacks of equal timeout instead
    // of after.
    if (firstTask === null) {
      // This is the first callback in the list.
      firstTask = continuationTask.next = continuationTask.previous = continuationTask;
    } else {
      var nextAfterContinuation = null;
      var t = firstTask;
      do {
        if (expirationTime <= t.expirationTime) {
          // This task times out at or after the continuation. We will insert
          // the continuation *before* this task.
          nextAfterContinuation = t;
          break;
        }
        t = t.next;
      } while (t !== firstTask);
      if (nextAfterContinuation === null) {
        // No equal or lower priority task was found, which means the new task
        // is the lowest priority task in the list.
        nextAfterContinuation = firstTask;
      } else if (nextAfterContinuation === firstTask) {
        // The new task is the highest priority task in the list.
        firstTask = continuationTask;
      }

      const previous = nextAfterContinuation.previous;
      previous.next = nextAfterContinuation.previous = continuationTask;
      continuationTask.next = nextAfterContinuation;
      continuationTask.previous = previous;
    }
  }
}

function advanceTimers(currentTime) {
  // Check for tasks that are no longer delayed and add them to the queue.
  if (firstDelayedTask !== null && firstDelayedTask.startTime <= currentTime) {
    do {
      const task = firstDelayedTask;
      const next = task.next;
      if (task === next) {
        firstDelayedTask = null;
      } else {
        firstDelayedTask = next;
        const previous = task.previous;
        previous.next = next;
        next.previous = previous;
      }
      task.next = task.previous = null;
      insertScheduledTask(task, task.expirationTime);
    } while (
      firstDelayedTask !== null &&
      firstDelayedTask.startTime <= currentTime
    );
  }
}

function handleTimeout(currentTime) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (firstTask !== null) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    } else if (firstDelayedTask !== null) {
      requestHostTimeout(
        handleTimeout,
        firstDelayedTask.startTime - currentTime,
      );
    }
  }
}

function flushWork(hasTimeRemaining, initialTime) {
  // Exit right away if we're currently paused
  if (enableSchedulerDebugging && isSchedulerPaused) {
    return;
  }

  // We'll need a host callback the next time work is scheduled.
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    // We scheduled a timeout but it's no longer needed. Cancel it.
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  let currentTime = initialTime;
  advanceTimers(currentTime);

  isPerformingWork = true;
  try {
    if (!hasTimeRemaining) {
      // Flush all the expired callbacks without yielding.
      // TODO: Split flushWork into two separate functions instead of using
      // a boolean argument?
      while (
        firstTask !== null &&
        firstTask.expirationTime <= currentTime &&
        !(enableSchedulerDebugging && isSchedulerPaused)
      ) {
        flushTask(firstTask, currentTime);
        currentTime = getCurrentTime();
        advanceTimers(currentTime);
      }
    } else {
      // Keep flushing callbacks until we run out of time in the frame.
      if (firstTask !== null) {
        do {
          flushTask(firstTask, currentTime);
          currentTime = getCurrentTime();
          advanceTimers(currentTime);
        } while (
          firstTask !== null &&
          !shouldYieldToHost() &&
          !(enableSchedulerDebugging && isSchedulerPaused)
        );
      }
    }
    // Return whether there's additional work
    if (firstTask !== null) {
      return true;
    } else {
      if (firstDelayedTask !== null) {
        requestHostTimeout(
          handleTimeout,
          firstDelayedTask.startTime - currentTime,
        );
      }
      return false;
    }
  } finally {
    isPerformingWork = false;
  }
}

function unstable_runWithPriority(priorityLevel, eventHandler) {
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
    case LowPriority:
    case IdlePriority:
      break;
    default:
      priorityLevel = NormalPriority;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_next(eventHandler) {
  var priorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // Shift down to normal priority
      priorityLevel = NormalPriority;
      break;
    default:
      // Anything lower than normal priority should remain at the current level.
      priorityLevel = currentPriorityLevel;
      break;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_wrapCallback(callback) {
  var parentPriorityLevel = currentPriorityLevel;
  return function() {
    // This is a fork of runWithPriority, inlined for performance.
    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = parentPriorityLevel;

    try {
      return callback.apply(this, arguments);
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}

function timeoutForPriorityLevel(priorityLevel) {
  switch (priorityLevel) {
    case ImmediatePriority:
      return IMMEDIATE_PRIORITY_TIMEOUT;
    case UserBlockingPriority:
      return USER_BLOCKING_PRIORITY;
    case IdlePriority:
      return IDLE_PRIORITY;
    case LowPriority:
      return LOW_PRIORITY_TIMEOUT;
    case NormalPriority:
    default:
      return NORMAL_PRIORITY_TIMEOUT;
  }
}

//返回经过包装处理的task
function unstable_scheduleCallback(priorityLevel, callback, options) {
  var currentTime = getCurrentTime();

  var startTime;
  var timeout;

  //更新startTime（默认是现在）和timeout（默认5s）
  if (typeof options === 'object' && options !== null) {
    var delay = options.delay;
    if (typeof delay === 'number' && delay > 0) {
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
    timeout =
      typeof options.timeout === 'number'
        ? options.timeout
        : timeoutForPriorityLevel(priorityLevel);
  } else {
    // Times out immediately
    // var IMMEDIATE_PRIORITY_TIMEOUT = -1;
    // Eventually times out
    // var USER_BLOCKING_PRIORITY = 250;
    //普通优先级的过期时间是5s
    // var NORMAL_PRIORITY_TIMEOUT = 5000;
    //低优先级的过期时间是10s
    // var LOW_PRIORITY_TIMEOUT = 10000;

    timeout = timeoutForPriorityLevel(priorityLevel);
    startTime = currentTime;
  }
  //过期时间是当前时间+5s，也就是默认是5s后，react进行更新
  var expirationTime = startTime + timeout;

  var newTask = {
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    next: null,
    previous: null,
  };
  //如果开始调度的时间已经错过了
  if (startTime > currentTime) {
    // This is a delayed task.
    //将延期的callback插入到延期队列中
    insertDelayedTask(newTask, startTime);
    //如果调度队列的头任务没有，并且延迟调度队列的头任务正好是新任务，
    //说明所有任务均延期，并且此时的任务是第一个延期任务
    if (firstTask === null && firstDelayedTask === newTask) {
      // All tasks are delayed, and this is the task with the earliest delay.
      //如果延迟调度开始的flag为true，则取消定时的时间
      if (isHostTimeoutScheduled) {
        // Cancel an existing timeout.
        cancelHostTimeout();
      }
      //否则设为true
      else {
        isHostTimeoutScheduled = true;
      }
      // Schedule a timeout.
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  }
  //没有延期的话，则按计划插入task
  else {
    insertScheduledTask(newTask, expirationTime);
    // Schedule a host callback, if needed. If we're already performing work,
    // wait until the next time we yield.
    //更新调度执行的标志
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }
  //返回经过包装处理的task
  return newTask;
}

function insertScheduledTask(newTask, expirationTime) {
  // Insert the new task into the list, ordered first by its timeout, then by
  // insertion. So the new task is inserted after any other task the
  // same timeout
  if (firstTask === null) {
    // This is the first task in the list.
    firstTask = newTask.next = newTask.previous = newTask;
  } else {
    var next = null;
    var task = firstTask;
    do {
      if (expirationTime < task.expirationTime) {
        // The new task times out before this one.
        next = task;
        break;
      }
      task = task.next;
    } while (task !== firstTask);

    if (next === null) {
      // No task with a later timeout was found, which means the new task has
      // the latest timeout in the list.
      next = firstTask;
    } else if (next === firstTask) {
      // The new task has the earliest expiration in the entire list.
      firstTask = newTask;
    }

    var previous = next.previous;
    previous.next = next.previous = newTask;
    newTask.next = next;
    newTask.previous = previous;
  }
}

function insertDelayedTask(newTask, startTime) {
  // Insert the new task into the list, ordered by its start time.
  if (firstDelayedTask === null) {
    // This is the first task in the list.
    firstDelayedTask = newTask.next = newTask.previous = newTask;
  } else {
    var next = null;
    var task = firstDelayedTask;
    do {
      if (startTime < task.startTime) {
        // The new task times out before this one.
        next = task;
        break;
      }
      task = task.next;
    } while (task !== firstDelayedTask);

    if (next === null) {
      // No task with a later timeout was found, which means the new task has
      // the latest timeout in the list.
      next = firstDelayedTask;
    } else if (next === firstDelayedTask) {
      // The new task has the earliest expiration in the entire list.
      firstDelayedTask = newTask;
    }

    var previous = next.previous;
    previous.next = next.previous = newTask;
    newTask.next = next;
    newTask.previous = previous;
  }
}

function unstable_pauseExecution() {
  isSchedulerPaused = true;
}

function unstable_continueExecution() {
  isSchedulerPaused = false;
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }
}

function unstable_getFirstCallbackNode() {
  return firstTask;
}
//从链表中移除task节点
function unstable_cancelCallback(task) {
  //获取callbackNode的next节点
  var next = task.next;
  //由于链表是双向循环链表，一旦next是null则证明该节点已不存在于链表中
  if (next === null) {
    // Already cancelled.
    return;
  }
  //自己等于自己，说明链表中就这一个callback节点
  //firstTask/firstDelayedTask应该是类似游标的概念，即正要执行的节点
  if (task === next) {
    //置为null，即删除callback节点
    //重置firstTask/firstDelayedTask
    if (task === firstTask) {
      firstTask = null;
    } else if (task === firstDelayedTask) {
      firstDelayedTask = null;
    }
  } else {
    //将firstTask/firstDelayedTask指向下一节点
    if (task === firstTask) {
      firstTask = next;
    } else if (task === firstDelayedTask) {
      firstDelayedTask = next;
    }
    var previous = task.previous;
    //熟悉的链表操作，删除已存在的callbackNode
    previous.next = next;
    next.previous = previous;
  }

  task.next = task.previous = null;
}

function unstable_getCurrentPriorityLevel() {
  return currentPriorityLevel;
}

function unstable_shouldYield() {
  const currentTime = getCurrentTime();
  advanceTimers(currentTime);
  return (
    (currentTask !== null &&
      firstTask !== null &&
      firstTask.startTime <= currentTime &&
      firstTask.expirationTime < currentTask.expirationTime) ||
    shouldYieldToHost()
  );
}

const unstable_requestPaint = requestPaint;

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback,
  unstable_cancelCallback,
  unstable_wrapCallback,
  unstable_getCurrentPriorityLevel,
  unstable_shouldYield,
  unstable_requestPaint,
  unstable_continueExecution,
  unstable_pauseExecution,
  unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
  forceFrameRate as unstable_forceFrameRate,
};
