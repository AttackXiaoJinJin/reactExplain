/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {enableIsInputPending} from '../SchedulerFeatureFlags';

// The DOM Scheduler implementation is similar to requestIdleCallback. It
// works by scheduling a requestAnimationFrame, storing the time for the start
// of the frame, then scheduling a postMessage which gets scheduled after paint.
// Within the postMessage handler do as much work as possible until time + frame
// rate. By separating the idle call into a separate event tick we ensure that
// layout, paint and other browser work is counted against the available time.
// The frame rate is dynamically adjusted.

export let requestHostCallback;
export let cancelHostCallback;
export let requestHostTimeout;
export let cancelHostTimeout;
export let shouldYieldToHost;
export let requestPaint;
export let getCurrentTime;
export let forceFrameRate;

const hasNativePerformanceNow =
  typeof performance === 'object' && typeof performance.now === 'function';

// We capture a local reference to any global, in case it gets polyfilled after
// this module is initially evaluated. We want to be using a
// consistent implementation.
const localDate = Date;

// This initialization code may run even on server environments if a component
// just imports ReactDOM (e.g. for findDOMNode). Some environments might not
// have setTimeout or clearTimeout. However, we always expect them to be defined
// on the client. https://github.com/facebook/react/pull/13088
const localSetTimeout =
  typeof setTimeout === 'function' ? setTimeout : undefined;
const localClearTimeout =
  typeof clearTimeout === 'function' ? clearTimeout : undefined;

// We don't expect either of these to necessarily be defined, but we will error
// later if they are missing on the client.
const localRequestAnimationFrame =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : undefined;
const localCancelAnimationFrame =
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : undefined;

// requestAnimationFrame does not run when the tab is in the background. If
// we're backgrounded we prefer for that work to happen so that the page
// continues to load in the background. So we also schedule a 'setTimeout' as
// a fallback.
// TODO: Need a better heuristic for backgrounded work.
//最晚执行时间为 100ms
const ANIMATION_FRAME_TIMEOUT = 100;
let rAFID;
let rAFTimeoutID;
//防止localRequestAnimationFrame长时间（100ms）内没有调用，
//强制执行 callback 函数
const requestAnimationFrameWithTimeout = function(callback) {
  // schedule rAF and also a setTimeout
  /*如果 A 执行了，则取消 B*/
  //就是window.requestAnimationFrame API
  //如果屏幕刷新率是 30Hz,即一帧是 33ms 的话，那么就是每 33ms 执行一次

  //timestamp表示requestAnimationFrame() 开始去执行回调函数的时刻，是requestAnimationFrame自带的参数
  rAFID = localRequestAnimationFrame(function(timestamp) {
    // cancel the setTimeout
    //已经比 B 先执行了，就取消 B 的执行
    localClearTimeout(rAFTimeoutID);
    callback(timestamp);
  });
  //如果超过 100ms 仍未执行的话
  /*如果 B 执行了，则取消 A*/
  rAFTimeoutID = localSetTimeout(function() {
    // cancel the requestAnimationFrame
    //取消 localRequestAnimationFrame
    localCancelAnimationFrame(rAFID);
    //直接调用回调函数
    callback(getCurrentTime());
  }, ANIMATION_FRAME_TIMEOUT);
};

if (hasNativePerformanceNow) {
  const Performance = performance;
  getCurrentTime = function() {
    return Performance.now();
  };
} else {
  getCurrentTime = function() {
    return localDate.now();
  };
}

if (
  // If Scheduler runs in a non-DOM environment, it falls back to a naive
  // implementation using setTimeout.
  typeof window === 'undefined' ||
  // Check if MessageChannel is supported, too.
  typeof MessageChannel !== 'function'
) {
  // If this accidentally gets imported in a non-browser environment, e.g. JavaScriptCore,
  // fallback to a naive implementation.
  let _callback = null;
  let _timeoutID = null;
  const _flushCallback = function() {
    if (_callback !== null) {
      try {
        const currentTime = getCurrentTime();
        const hasRemainingTime = true;
        _callback(hasRemainingTime, currentTime);
        _callback = null;
      } catch (e) {
        setTimeout(_flushCallback, 0);
        throw e;
      }
    }
  };
  requestHostCallback = function(cb) {
    if (_callback !== null) {
      // Protect against re-entrancy.
      setTimeout(requestHostCallback, 0, cb);
    } else {
      _callback = cb;
      setTimeout(_flushCallback, 0);
    }
  };
  cancelHostCallback = function() {
    _callback = null;
  };
  requestHostTimeout = function(cb, ms) {
    _timeoutID = setTimeout(cb, ms);
  };
  cancelHostTimeout = function() {
    clearTimeout(_timeoutID);
  };
  shouldYieldToHost = function() {
    return false;
  };
  requestPaint = forceFrameRate = function() {};
} else {
  if (typeof console !== 'undefined') {
    // TODO: Remove fb.me link
    if (typeof localRequestAnimationFrame !== 'function') {
      console.error(
        "This browser doesn't support requestAnimationFrame. " +
          'Make sure that you load a ' +
          'polyfill in older browsers. https://fb.me/react-polyfills',
      );
    }
    if (typeof localCancelAnimationFrame !== 'function') {
      console.error(
        "This browser doesn't support cancelAnimationFrame. " +
          'Make sure that you load a ' +
          'polyfill in older browsers. https://fb.me/react-polyfills',
      );
    }
  }

  let scheduledHostCallback = null;
  let isMessageEventScheduled = false;

  let isAnimationFrameScheduled = false;

  let timeoutID = -1;

  let frameDeadline = 0;
  // We start out assuming that we run at 30fps but then the heuristic tracking
  // will adjust this value to a faster fps if we get more frequent animation
  // frames.
  let previousFrameTime = 33;
  //保持浏览器每秒 30 帧的情况下，每一帧为 33ms
  let activeFrameTime = 33;
  let fpsLocked = false;

  // TODO: Make this configurable
  // TODO: Adjust this based on priority?
  let maxFrameLength = 300;
  let needsPaint = false;

  if (
    enableIsInputPending &&
    navigator !== undefined &&
    navigator.scheduling !== undefined &&
    navigator.scheduling.isInputPending !== undefined
  ) {
    const scheduling = navigator.scheduling;
    shouldYieldToHost = function() {
      const currentTime = getCurrentTime();
      if (currentTime >= frameDeadline) {
        // There's no time left in the frame. We may want to yield control of
        // the main thread, so the browser can perform high priority tasks. The
        // main ones are painting and user input. If there's a pending paint or
        // a pending input, then we should yield. But if there's neither, then
        // we can yield less often while remaining responsive. We'll eventually
        // yield regardless, since there could be a pending paint that wasn't
        // accompanied by a call to `requestPaint`, or other main thread tasks
        // like network events.
        if (needsPaint || scheduling.isInputPending()) {
          // There is either a pending paint or a pending input.
          return true;
        }
        // There's no pending input. Only yield if we've reached the max
        // frame length.
        return currentTime >= frameDeadline + maxFrameLength;
      } else {
        // There's still time left in the frame.
        return false;
      }
    };

    requestPaint = function() {
      needsPaint = true;
    };
  } else {
    // `isInputPending` is not available. Since we have no way of knowing if
    // there's pending input, always yield at the end of the frame.
    shouldYieldToHost = function() {
      return getCurrentTime() >= frameDeadline;
    };

    // Since we yield every frame regardless, `requestPaint` has no effect.
    requestPaint = function() {};
  }

  forceFrameRate = function(fps) {
    if (fps < 0 || fps > 125) {
      console.error(
        'forceFrameRate takes a positive int between 0 and 125, ' +
          'forcing framerates higher than 125 fps is not unsupported',
      );
      return;
    }
    if (fps > 0) {
      activeFrameTime = Math.floor(1000 / fps);
      fpsLocked = true;
    } else {
      // reset the framerate
      activeFrameTime = 33;
      fpsLocked = false;
    }
  };

  // We use the postMessage trick to defer idle work until after the repaint.
  /*idleTick()*/
  const channel = new MessageChannel();
  const port = channel.port2;
  //当调用 port.postMessage(undefined) 就会执行该方法
  channel.port1.onmessage = function(event) {
    isMessageEventScheduled = false;
    //有调度任务的话
    if (scheduledHostCallback !== null) {
      const currentTime = getCurrentTime();
      const hasTimeRemaining = frameDeadline - currentTime > 0;
      try {
        const hasMoreWork = scheduledHostCallback(
          hasTimeRemaining,
          currentTime,
        );
        //仍有调度任务的话，继续执行帧调度
        if (hasMoreWork) {
          // Ensure the next frame is scheduled.
          if (!isAnimationFrameScheduled) {
            isAnimationFrameScheduled = true;
            requestAnimationFrameWithTimeout(animationTick);
          }
        } else {
          scheduledHostCallback = null;
        }
      } catch (error) {
        // If a scheduler task throws, exit the current browser task so the
        // error can be observed, and post a new task as soon as possible
        // so we can continue where we left off.
        //如果调度任务因为报错而中断了，React 尽可能退出当前浏览器执行的任务，
        //继续执行下一个调度任务
        isMessageEventScheduled = true;
        port.postMessage(undefined);
        throw error;
      }
      // Yielding to the browser will give it a chance to paint, so we can
      // reset this.
      //判断浏览器是否强制渲染的标志
      needsPaint = false;
    }
  };

  //计算每一帧中 react 进行调度任务的时长，并执行该 callback
  const animationTick = function(rafTime) {
    //如果不为 null 的话，立即请求下一帧重复做这件事
    //这么做的原因是：调度队列有多个 callback，
    // 不能保证在一个 callback 完成后，刚好能在下一帧继续执行下一个 callback，
    //所以在当前 callback 存在的同时，执行下一帧的 callback
    if (scheduledHostCallback !== null) {
      // Eagerly schedule the next animation callback at the beginning of the
      // frame. If the scheduler queue is not empty at the end of the frame, it
      // will continue flushing inside that callback. If the queue *is* empty,
      // then it will exit immediately. Posting the callback at the start of the
      // frame ensures it's fired within the earliest possible frame. If we
      // waited until the end of the frame to post the callback, we risk the
      // browser skipping a frame and not firing the callback until the frame
      // after that.
      requestAnimationFrameWithTimeout(animationTick);
    } else {
      // No pending work. Exit.
      //没有 callback 要被调度，退出
      isAnimationFrameScheduled = false;
      return;
    }
    //用来计算下一帧有多少时间是留给react 去执行调度的
    //rafTime:requestAnimationFrame执行的时间
    //frameDeadline:0 ，每一帧执行后，超出的时间
    //activeFrameTime:33，每一帧的执行事件
    let nextFrameTime = rafTime - frameDeadline + activeFrameTime;
    //如果调度执行时间没有超过一帧时间
    if (
      nextFrameTime < activeFrameTime &&
      previousFrameTime < activeFrameTime &&
      !fpsLocked
    ) {
      //React 不支持每一帧比 8ms 还要短，即 120 帧
      //小于 8ms 的话，强制至少有 8ms 来执行调度
      if (nextFrameTime < 8) {
        // Defensive coding. We don't support higher frame rates than 120hz.
        // If the calculated frame time gets lower than 8, it is probably a bug.
        nextFrameTime = 8;
      }
      // If one frame goes long, then the next one can be short to catch up.
      // If two frames are short in a row, then that's an indication that we
      // actually have a higher frame rate than what we're currently optimizing.
      // We adjust our heuristic dynamically accordingly. For example, if we're
      // running on 120hz display or 90hz VR display.
      // Take the max of the two in case one of them was an anomaly due to
      // missed frame deadlines.
      //哪个长选哪个
      //如果上个帧里的调度回调结束得早的话，那么就有多的时间给下个帧的调度时间
      activeFrameTime =
        nextFrameTime < previousFrameTime ? previousFrameTime : nextFrameTime;
    } else {
      previousFrameTime = nextFrameTime;
    }
    frameDeadline = rafTime + activeFrameTime;
    //通知已经开始帧调度了
    if (!isMessageEventScheduled) {
      isMessageEventScheduled = true;
      port.postMessage(undefined);
    }
  };

  //在每一帧内执行调度任务（callback）
  requestHostCallback = function(callback) {
    if (scheduledHostCallback === null) {
      //firstCallbackNode 传进来的 callback
      scheduledHostCallback = callback;
      //如果 react 在帧里面还未超时（即多占用了浏览器的时间）
      //还未开始调度
      if (!isAnimationFrameScheduled) {
        // If rAF didn't already schedule one, we need to schedule a frame.
        // TODO: If this rAF doesn't materialize because the browser throttles,
        // we might want to still have setTimeout trigger rIC as a backup to
        // ensure that we keep performing work.
        //开始调度
        isAnimationFrameScheduled = true;
        requestAnimationFrameWithTimeout(animationTick);
      }
    }
  };

  cancelHostCallback = function() {
    scheduledHostCallback = null;
    isMessageEventScheduled = false;
  };

  requestHostTimeout = function(callback, ms) {
    timeoutID = localSetTimeout(() => {
      callback(getCurrentTime());
    }, ms);
  };

  cancelHostTimeout = function() {
    localClearTimeout(timeoutID);
    timeoutID = -1;
  };
}
