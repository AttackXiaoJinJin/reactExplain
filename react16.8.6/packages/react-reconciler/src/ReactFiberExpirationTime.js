/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactPriorityLevel} from './SchedulerWithReactIntegration';

import MAX_SIGNED_31_BIT_INT from './maxSigned31BitInt';

import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  IdlePriority,
} from './SchedulerWithReactIntegration';

export type ExpirationTime = number;

export const NoWork = 0;
export const Never = 1;
//1073741823
export const Sync = MAX_SIGNED_31_BIT_INT;
//1073741822
export const Batched = Sync - 1;

const UNIT_SIZE = 10;
//1073741821
const MAGIC_NUMBER_OFFSET = Batched - 1;

// 1 unit of expiration time represents 10ms.
//10ms表示一个过期时间
//MAGIC_NUMBER_OFFSET表示的是整型最大值1073741823
export function msToExpirationTime(ms: number): ExpirationTime {
  // Always add an offset so that we don't clash with the magic number for NoWork.
  //总是添加一个偏移量，这样我们就不会与NoWork的神奇数字发生冲突

  //| 0 是取整。console.log(19 / 3 | 0); //6
  return MAGIC_NUMBER_OFFSET - ((ms / UNIT_SIZE) | 0);
}

export function expirationTimeToMs(expirationTime: ExpirationTime): number {
  return (MAGIC_NUMBER_OFFSET - expirationTime) * UNIT_SIZE;
}

function ceiling(num: number, precision: number): number {
  return (((num / precision) | 0) + 1) * precision;
}
//计算过期时间
function computeExpirationBucket(
  currentTime,
  expirationInMs,
  bucketSizeMs,
): ExpirationTime {
  return (
    //1073741821
    MAGIC_NUMBER_OFFSET -
    ceiling(
      //   1073741821-currentTime+(high 150 或者 low 5000  /10)  ,
      MAGIC_NUMBER_OFFSET - currentTime + expirationInMs / UNIT_SIZE,
      //(high 100 或者 low 250  /10 )
      bucketSizeMs / UNIT_SIZE,
    )
  );


  //high 情况
  1073741821-ceiling(1073741821-currentTime+15,10)

  //low 情况
  1073741821-ceiling(1073741821-currentTime+500,25)


  1073741821-((((1073741821-currentTime+500) / 25) | 0) + 1) * 25

  1073741821-((1073741821/25-currentTime/25+20 | 0) + 1) * 25


  1073741821-((1073741821/25-currentTime/25+20*25/25 | 0) + 1) * 25

  1073741821-((1073741821-currentTime+500)/25 | 0)*25 - 25

  1073741796-((1073741821-currentTime+500)/25 | 0)*25

  1073741796-((1073742321-currentTime)/25 | 0)*25
  //===================
  1796-((2321-currentTime)/25 | 0)*25

  //currentTime是2000
  1796-(321/25 | 0)*25 //1796-300

  //currentTime是2010
  1796-(311/25 | 0)*25 //1796-300

  //currentTime是2024
  1796-(311/25 | 0)*25 //1796-275

  //currentTime是2025
  1796-(311/25 | 0)*25 //1796-275

}

// TODO: This corresponds to Scheduler's NormalPriority, not LowPriority. Update
// the names to reflect.
//低权限的过期时间
export const LOW_PRIORITY_EXPIRATION = 5000;
export const LOW_PRIORITY_BATCH_SIZE = 250;
//普通的异步的expirationTime
export function computeAsyncExpiration(
  currentTime: ExpirationTime,
): ExpirationTime {
  return computeExpirationBucket(
    currentTime,
    //5000
    LOW_PRIORITY_EXPIRATION,
    //250
    LOW_PRIORITY_BATCH_SIZE,
  );
}

export function computeSuspenseExpiration(
  currentTime: ExpirationTime,
  timeoutMs: number,
): ExpirationTime {
  // TODO: Should we warn if timeoutMs is lower than the normal pri expiration time?
  return computeExpirationBucket(
    currentTime,
    timeoutMs,
    LOW_PRIORITY_BATCH_SIZE,
  );
}

// We intentionally set a higher expiration time for interactive updates in
// dev than in production.
//
// If the main thread is being blocked so long that you hit the expiration,
// it's a problem that could be solved with better scheduling.
//
// People will be more likely to notice this and fix it with the long
// expiration time in development.
//
// In production we opt for better UX at the risk of masking scheduling
// problems, by expiring fast.
//高权限的过期时间
export const HIGH_PRIORITY_EXPIRATION = __DEV__ ? 500 : 150;
export const HIGH_PRIORITY_BATCH_SIZE = 100;
//高权限的expirationTime一般是由交互事件触发的，所以响应的优先级较高
export function computeInteractiveExpiration(currentTime: ExpirationTime) {
  return computeExpirationBucket(
    currentTime,
    HIGH_PRIORITY_EXPIRATION,
    HIGH_PRIORITY_BATCH_SIZE,
  );
}
//通过 expirationTime 推断优先级
export function inferPriorityFromExpirationTime(
  currentTime: ExpirationTime,
  expirationTime: ExpirationTime,
): ReactPriorityLevel {
  if (expirationTime === Sync) {
    return ImmediatePriority;
  }
  if (expirationTime === Never) {
    return IdlePriority;
  }
  const msUntil =
    expirationTimeToMs(expirationTime) - expirationTimeToMs(currentTime);
  if (msUntil <= 0) {
    return ImmediatePriority;
  }
  if (msUntil <= HIGH_PRIORITY_EXPIRATION + HIGH_PRIORITY_BATCH_SIZE) {
    return UserBlockingPriority;
  }
  if (msUntil <= LOW_PRIORITY_EXPIRATION + LOW_PRIORITY_BATCH_SIZE) {
    return NormalPriority;
  }

  // TODO: Handle LowPriority

  // Assume anything lower has idle priority
  return IdlePriority;
}
