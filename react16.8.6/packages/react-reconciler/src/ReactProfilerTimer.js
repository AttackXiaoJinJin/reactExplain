/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';

import {enableProfilerTimer} from 'shared/ReactFeatureFlags';

// Intentionally not named imports because Rollup would use dynamic dispatch for
// CommonJS interop named imports.
import * as Scheduler from 'scheduler';

const {unstable_now: now} = Scheduler;

export type ProfilerTimer = {
  getCommitTime(): number,
  recordCommitTime(): void,
  startProfilerTimer(fiber: Fiber): void,
  stopProfilerTimerIfRunning(fiber: Fiber): void,
  stopProfilerTimerIfRunningAndRecordDelta(fiber: Fiber): void,
};

let commitTime: number = 0;
let profilerStartTime: number = -1;

function getCommitTime(): number {
  return commitTime;
}

function recordCommitTime(): void {
  if (!enableProfilerTimer) {
    return;
  }
  commitTime = now();
}
//启动分析器的timer，并赋成当前时间
function startProfilerTimer(fiber: Fiber): void {
  //如果不能启动分析器的timer的话，就 return
  if (!enableProfilerTimer) {
    return;
  }
  //分析器的开始时间
  profilerStartTime = now();
  //如果 fiber 节点的实际开始时间 < 0 的话，则赋成当前时间
  if (((fiber.actualStartTime: any): number) < 0) {
    fiber.actualStartTime = now();
  }
}

function stopProfilerTimerIfRunning(fiber: Fiber): void {
  if (!enableProfilerTimer) {
    return;
  }
  profilerStartTime = -1;
}

//记录分析器的timer的work 时间，并停止timer
function stopProfilerTimerIfRunningAndRecordDelta(
  fiber: Fiber,
  overrideBaseTime: boolean,
): void {
  //如果不能启动分析器的定时器的话，就 return
  if (!enableProfilerTimer) {
    return;
  }
  //如果分析器的开始时间>=0的话
  if (profilerStartTime >= 0) {
    //获取运行的时间间隔
    const elapsedTime = now() - profilerStartTime;
    //累计实际 work 时间间隔
    fiber.actualDuration += elapsedTime;
    if (overrideBaseTime) {
      //记录时间间隔
      fiber.selfBaseDuration = elapsedTime;
    }
    //上述操作完成后，将分析器的timer的开始时间重置为-1
    profilerStartTime = -1;
  }
}

export {
  getCommitTime,
  recordCommitTime,
  startProfilerTimer,
  stopProfilerTimerIfRunning,
  stopProfilerTimerIfRunningAndRecordDelta,
};
