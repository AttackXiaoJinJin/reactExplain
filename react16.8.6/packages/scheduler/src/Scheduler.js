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

//将调度任务从调度队列中拿出，并执行；
//将调度任务生出的子调度任务插入到其后
function flushTask(task, currentTime) {
  // Remove the task from the list before calling the callback. That way the
  // list is in a consistent state even if the callback throws.
  // 将过期的任务在调度前从调度队列中移除，以让调度队列的任务均保持不过期（一致）的状态
  const next = task.next;
  // 如果当前队列中只有一个回调任务，则清空队列
  if (next === task) {
    // This is the only scheduled task. Clear the list.
    firstTask = null;
  }
  else {
    // Remove the task from its position in the list.
    //如果当前任务正好等于firstTask，则firstTask指向下一个回调任务
    if (task === firstTask) {
      firstTask = next;
    }
    // 将该 task 从调度队列中拿出来
    const previous = task.previous;
    previous.next = next;
    next.previous = previous;
  }
  // 单独拿出 task，以便安全地执行它
  task.next = task.previous = null;

  // Now it's safe to execute the task.
  var callback = task.callback;
  // 之前的调度优先级
  var previousPriorityLevel = currentPriorityLevel;
  // 之前的调度任务
  var previousTask = currentTask;

  // 当前任务
  currentPriorityLevel = task.priorityLevel;
  currentTask = task;
  // 回调任务返回的内容
  var continuationCallback;
  try {
    // 当前的回调任务是否超时,false 超时，true 没有
    var didUserCallbackTimeout = task.expirationTime <= currentTime;
    // 执行回调任务，返回的结果由 continuationCallback 保存
    continuationCallback = callback(didUserCallbackTimeout);
  } catch (error) {
    throw error;
  } finally {
    // 重置任务优先级和任务
    currentPriorityLevel = previousPriorityLevel;
    currentTask = previousTask;
  }

  // A callback may return a continuation. The continuation should be scheduled
  // with the same priority and expiration as the just-finished callback.
  // 调度任务可能会有返回的内容，如果返回的是一个 function，
  // 该 function 应该和刚刚执行的 callback 一样，有同样的优先级
  if (typeof continuationCallback === 'function') {
    var expirationTime = task.expirationTime;
    // 将回调任务的结果再拼成一个子回调任务
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

    // 如果调度队列为空的话，将子回调任务插入调度队列
    if (firstTask === null) {
      // This is the first callback in the list.
      firstTask = continuationTask.next = continuationTask.previous = continuationTask;
    }
    //判断子回调任务的优先级
    else {
      var nextAfterContinuation = null;
      var t = firstTask;
      // 如果当前调度优先级小于 firstTask 的优先级的话，
      // 下一个要执行的调度任务就是 firstTask
      // ps:但是这个循环感觉不会执行，因为 var t = firstTask;
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
        //没有相同或更低的优先级的调度任务找到，意味着新任务就是最低优先级的任务
        nextAfterContinuation = firstTask;
      }
      // 否则新任务是最高优先级的任务
      else if (nextAfterContinuation === firstTask) {
        // The new task is the highest priority task in the list.
        firstTask = continuationTask;
      }
      // 将子回调任务插入调度队列中
      const previous = nextAfterContinuation.previous;
      previous.next = nextAfterContinuation.previous = continuationTask;
      continuationTask.next = nextAfterContinuation;
      continuationTask.previous = previous;
    }
  }
}
//检查是否有不过期的任务，并把它们加入到新的调度队列中
function advanceTimers(currentTime) {
  // Check for tasks that are no longer delayed and add them to the queue.
  //开始时间已经晚于当前时间了
  if (firstDelayedTask !== null && firstDelayedTask.startTime <= currentTime) {
    do {
      const task = firstDelayedTask;
      const next = task.next;
      //调度任务队列是一个环状的链表
      //说明只有一个过期任务，将其置为 null
      if (task === next) {
        firstDelayedTask = null;
      }
      //将当前的 task 挤掉
      else {
        firstDelayedTask = next;
        const previous = task.previous;
        previous.next = next;
        next.previous = previous;
      }
      //让 task 摆脱与旧的调度队列的依赖
      task.next = task.previous = null;
      //将 task 插入到新的调度队列中
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
//const hasTimeRemaining = frameDeadline - currentTime > 0
//hasTimeRemaining 是每一帧内留给 react 的时间
//initialTime 即 currentTime
function flushWork(hasTimeRemaining, initialTime) {
  // Exit right away if we're currently paused
  //如果 React 没有掌握浏览器的控制权，则不执行调度任务
  if (enableSchedulerDebugging && isSchedulerPaused) {
    return;
  }

  // We'll need a host callback the next time work is scheduled.
  //调度任务执行的标识
  //调度任务是否执行
  isHostCallbackScheduled = false;
  //调度任务是否超时
  //一旦超时,
  if (isHostTimeoutScheduled) {
    // We scheduled a timeout but it's no longer needed. Cancel it.
    isHostTimeoutScheduled = false;
    /*cancelHostCallback*/
    cancelHostTimeout();
  }

  let currentTime = initialTime;
  // 检查是否有不过期的任务，并把它们加入到新的调度队列中
  advanceTimers(currentTime);
  /*isExecutingCallback 是否正在调用callback*/
  isPerformingWork = true;
  try {
    // 如果在一帧内执行时间超时，没有时间让 React 执行调度任务的话
    if (!hasTimeRemaining) {
      // Flush all the expired callbacks without yielding.
      // TODO: Split flushWork into two separate functions instead of using
      // a boolean argument?
      //一直执行过期的任务，直到到达一个不过期的任务为止
      while (
        /*firstTask即firstCallbackNode*/
        firstTask !== null &&
        //如果firstTask.expirationTime一直小于等于currentTime的话，则一直执行flushTask方法
        firstTask.expirationTime <= currentTime &&
        !(enableSchedulerDebugging && isSchedulerPaused)
      ) {
        /*flushTask即flushFirstCallback*/
        flushTask(firstTask, currentTime);
        currentTime = getCurrentTime();
        //检查是否有不过期的任务，并把它们加入到新的调度队列中
        advanceTimers(currentTime);
      }
    } else {
      // Keep flushing callbacks until we run out of time in the frame.
      //除非在一帧内执行时间超时，否则一直刷新 callback 队列
      //仍有时间剩余并且旧调度队列不为空时，将不过期的任务加入到新的调度队列中
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
        //执行延期的任务
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

//临时替换当前的优先级，去执行传进来的 callback
function unstable_runWithPriority(priorityLevel, eventHandler) {
  //默认是 NormalPriority
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

  //缓存当前优先级 currentPriorityLevel
  var previousPriorityLevel = currentPriorityLevel;
  //临时替换优先级，去执行 eventHandler()
  currentPriorityLevel = priorityLevel;
  //try 里 return 了，还是会执行 finally 内的语句
  try {
    return eventHandler();
  } finally {
    //恢复当前优先级为之前的优先级
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
  //封装成新的任务
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
    /*ensureHostCallbackIsScheduled()*/
    if (firstTask === null && firstDelayedTask === newTask) {
      // All tasks are delayed, and this is the task with the earliest delay.
      //如果延迟调度开始的flag为true，则取消定时的时间
      /*isHostCallbackScheduled*/
      if (isHostTimeoutScheduled) {
        // Cancel an existing timeout.
        /*cancelHostCallback*/
        cancelHostTimeout();
      }
      //否则设为true
      else {
        isHostTimeoutScheduled = true;
      }
      // Schedule a timeout.
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
    //========================================
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
//将 newTask 插入到新的调度队列中
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
    //React对传进来的 callback 进行排序，
    // 优先级高的排在前面，优先级低的排在后面
    do {
      if (expirationTime < task.expirationTime) {
        // The new task times out before this one.
        next = task;
        break;
      }
      task = task.next;
    } while (task !== firstTask);
    //优先级最小的话
    if (next === null) {
      // No task with a later timeout was found, which means the new task has
      // the latest timeout in the list.
      next = firstTask;
    }
    //优先级最高的话
    else if (next === firstTask) {
      // The new task has the earliest expiration in the entire list.
      firstTask = newTask;
    }
    //插入 newTask
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
