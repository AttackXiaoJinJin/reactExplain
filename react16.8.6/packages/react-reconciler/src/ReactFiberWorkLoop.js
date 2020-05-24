/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';
import type {FiberRoot} from './ReactFiberRoot';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {
  ReactPriorityLevel,
  SchedulerCallback,
} from './SchedulerWithReactIntegration';
import type {Interaction} from 'scheduler/src/Tracing';
import type {SuspenseConfig} from './ReactFiberSuspenseConfig';

import {
  warnAboutDeprecatedLifecycles,
  enableUserTimingAPI,
  enableSuspenseServerRenderer,
  replayFailedUnitOfWorkWithInvokeGuardedCallback,
  enableProfilerTimer,
  enableSchedulerTracing,
  revertPassiveEffectsChange,
} from 'shared/ReactFeatureFlags';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import invariant from 'shared/invariant';
import warning from 'shared/warning';

import {
  scheduleCallback,
  cancelCallback,
  getCurrentPriorityLevel,
  runWithPriority,
  shouldYield,
  requestPaint,
  now,
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
  flushSyncCallbackQueue,
  scheduleSyncCallback,
} from './SchedulerWithReactIntegration';

import {__interactionsRef, __subscriberRef} from 'scheduler/tracing';

import {
  prepareForCommit,
  resetAfterCommit,
  scheduleTimeout,
  cancelTimeout,
  noTimeout,
  warnsIfNotActing,
} from './ReactFiberHostConfig';

import {createWorkInProgress, assignFiberPropertiesInDEV} from './ReactFiber';
import {
  NoMode,
  StrictMode,
  ProfileMode,
  BatchedMode,
  ConcurrentMode,
} from './ReactTypeOfMode';
import {
  HostRoot,
  ClassComponent,
  SuspenseComponent,
  DehydratedSuspenseComponent,
  FunctionComponent,
  ForwardRef,
  MemoComponent,
  SimpleMemoComponent,
} from 'shared/ReactWorkTags';
import {
  NoEffect,
  PerformedWork,
  Placement,
  Update,
  PlacementAndUpdate,
  Deletion,
  Ref,
  ContentReset,
  Snapshot,
  Callback,
  Passive,
  Incomplete,
  HostEffectMask,
} from 'shared/ReactSideEffectTags';
import {
  NoWork,
  Sync,
  Never,
  msToExpirationTime,
  expirationTimeToMs,
  computeInteractiveExpiration,
  computeAsyncExpiration,
  computeSuspenseExpiration,
  inferPriorityFromExpirationTime,
  LOW_PRIORITY_EXPIRATION,
  Batched,
} from './ReactFiberExpirationTime';
import {beginWork as originalBeginWork} from './ReactFiberBeginWork';
import {completeWork} from './ReactFiberCompleteWork';
import {unwindWork, unwindInterruptedWork} from './ReactFiberUnwindWork';
import {
  throwException,
  createRootErrorUpdate,
  createClassErrorUpdate,
} from './ReactFiberThrow';
import {
  commitBeforeMutationLifeCycles as commitBeforeMutationEffectOnFiber,
  commitLifeCycles as commitLayoutEffectOnFiber,
  commitPassiveHookEffects,
  commitPlacement,
  commitWork,
  commitDeletion,
  commitDetachRef,
  commitAttachRef,
  commitResetTextContent,
} from './ReactFiberCommitWork';
import {enqueueUpdate} from './ReactUpdateQueue';
import {resetContextDependencies} from './ReactFiberNewContext';
import {resetHooks, ContextOnlyDispatcher} from './ReactFiberHooks';
import {createCapturedValue} from './ReactCapturedValue';

import {
  recordCommitTime,
  startProfilerTimer,
  stopProfilerTimerIfRunningAndRecordDelta,
} from './ReactProfilerTimer';

// DEV stuff
import warningWithoutStack from 'shared/warningWithoutStack';
import getComponentName from 'shared/getComponentName';
import ReactStrictModeWarnings from './ReactStrictModeWarnings';
import {
  phase as ReactCurrentDebugFiberPhaseInDEV,
  resetCurrentFiber as resetCurrentDebugFiberInDEV,
  setCurrentFiber as setCurrentDebugFiberInDEV,
  getStackByFiberInDevAndProd,
} from './ReactCurrentFiber';
import {
  recordEffect,
  recordScheduleUpdate,
  startRequestCallbackTimer,
  stopRequestCallbackTimer,
  startWorkTimer,
  stopWorkTimer,
  stopFailedWorkTimer,
  startWorkLoopTimer,
  stopWorkLoopTimer,
  startCommitTimer,
  stopCommitTimer,
  startCommitSnapshotEffectsTimer,
  stopCommitSnapshotEffectsTimer,
  startCommitHostEffectsTimer,
  stopCommitHostEffectsTimer,
  startCommitLifeCyclesTimer,
  stopCommitLifeCyclesTimer,
} from './ReactDebugFiberPerf';
import {
  invokeGuardedCallback,
  hasCaughtError,
  clearCaughtError,
} from 'shared/ReactErrorUtils';
import {onCommitRoot} from './ReactFiberDevToolsHook';

const ceil = Math.ceil;

const {
  ReactCurrentDispatcher,
  ReactCurrentOwner,
  IsSomeRendererActing,
} = ReactSharedInternals;

type ExecutionContext = number;

const NoContext = /*                    */ 0b000000;
const BatchedContext = /*               */ 0b000001;
const EventContext = /*                 */ 0b000010;
const DiscreteEventContext = /*         */ 0b000100;
const LegacyUnbatchedContext = /*       */ 0b001000;
const RenderContext = /*                */ 0b010000;
const CommitContext = /*                */ 0b100000;

type RootExitStatus = 0 | 1 | 2 | 3 | 4;
const RootIncomplete = 0;
const RootErrored = 1;
const RootSuspended = 2;
const RootSuspendedWithDelay = 3;
const RootCompleted = 4;

export type Thenable = {
  then(resolve: () => mixed, reject?: () => mixed): Thenable | void,
};

// Describes where we are in the React execution stack
let executionContext: ExecutionContext = NoContext;
// The root we're working on
let workInProgressRoot: FiberRoot | null = null;
// The fiber we're working on
let workInProgress: Fiber | null = null;
// The expiration time we're rendering
let renderExpirationTime: ExpirationTime = NoWork;
// Whether to root completed, errored, suspended, etc.
let workInProgressRootExitStatus: RootExitStatus = RootIncomplete;
// Most recent event time among processed updates during this render.
// This is conceptually a time stamp but expressed in terms of an ExpirationTime
// because we deal mostly with expiration times in the hot path, so this avoids
// the conversion happening in the hot path.
let workInProgressRootLatestProcessedExpirationTime: ExpirationTime = Sync;
let workInProgressRootLatestSuspenseTimeout: ExpirationTime = Sync;
let workInProgressRootCanSuspendUsingConfig: null | SuspenseConfig = null;
// If we're pinged while rendering we don't always restart immediately.
// This flag determines if it might be worthwhile to restart if an opportunity
// happens latere.
let workInProgressRootHasPendingPing: boolean = false;
// The most recent time we committed a fallback. This lets us ensure a train
// model where we don't commit new loading states in too quick succession.
let globalMostRecentFallbackTime: number = 0;
const FALLBACK_THROTTLE_MS: number = 500;

let nextEffect: Fiber | null = null;
let hasUncaughtError = false;
let firstUncaughtError = null;
let legacyErrorBoundariesThatAlreadyFailed: Set<mixed> | null = null;

let rootDoesHavePassiveEffects: boolean = false;
let rootWithPendingPassiveEffects: FiberRoot | null = null;
let pendingPassiveEffectsExpirationTime: ExpirationTime = NoWork;

let rootsWithPendingDiscreteUpdates: Map<
  FiberRoot,
  ExpirationTime,
> | null = null;

// Use these to prevent an infinite loop of nested updates
const NESTED_UPDATE_LIMIT = 50;
let nestedUpdateCount: number = 0;
let rootWithNestedUpdates: FiberRoot | null = null;

const NESTED_PASSIVE_UPDATE_LIMIT = 50;
let nestedPassiveUpdateCount: number = 0;

let interruptedBy: Fiber | null = null;

// Marks the need to reschedule pending interactions at these expiration times
// during the commit phase. This enables them to be traced across components
// that spawn new work during render. E.g. hidden boundaries, suspended SSR
// hydration or SuspenseList.
let spawnedWorkDuringRender: null | Array<ExpirationTime> = null;

// Expiration times are computed by adding to the current time (the start
// time). However, if two updates are scheduled within the same event, we
// should treat their start times as simultaneous, even if the actual clock
// time has advanced between the first and second call.

// In other words, because expiration times determine how updates are batched,
// we want all updates of like priority that occur within the same event to
// receive the same expiration time. Otherwise we get tearing.
let currentEventTime: ExpirationTime = NoWork;
//计算当前时间
export function requestCurrentTime() {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    // We're inside React, so it's fine to read the actual time.
    return msToExpirationTime(now());
  }
  // We're not inside React, so we may be in the middle of a browser event.
  if (currentEventTime !== NoWork) {
    // Use the same start time for all updates until we enter React again.
    return currentEventTime;
  }
  // This is the first update since React yielded. Compute a new start time.
  //第一次更新的话，是走这边的
  currentEventTime = msToExpirationTime(now());
  //返回1073741823
  return currentEventTime;
}
//为fiber对象计算expirationTime
export function computeExpirationForFiber(
  currentTime: ExpirationTime,
  fiber: Fiber,
  suspenseConfig: null | SuspenseConfig,
): ExpirationTime {
  //可以在ReactTypeOfMode中看到是哪种类型的mode
  const mode = fiber.mode;
  if ((mode & BatchedMode) === NoMode) {
    return Sync;
  }
  //获取当前fiber的优先级
  const priorityLevel = getCurrentPriorityLevel();
  if ((mode & ConcurrentMode) === NoMode) {
    return priorityLevel === ImmediatePriority ? Sync : Batched;
  }

  if ((executionContext & RenderContext) !== NoContext) {
    // Use whatever time we're already rendering
    return renderExpirationTime;
  }

  let expirationTime;
  if (suspenseConfig !== null) {
    // Compute an expiration time based on the Suspense timeout.
    expirationTime = computeSuspenseExpiration(
      currentTime,
      suspenseConfig.timeoutMs | 0 || LOW_PRIORITY_EXPIRATION,
    );
  } else {
    // Compute an expiration time based on the Scheduler priority.
    switch (priorityLevel) {
      case ImmediatePriority:
        expirationTime = Sync;
        break;
      case UserBlockingPriority:
        // TODO: Rename this to computeUserBlockingExpiration
        //一个是计算交互事件（如点击）的过期时间
        expirationTime = computeInteractiveExpiration(currentTime);
        break;
      case NormalPriority:
      case LowPriority: // TODO: Handle LowPriority
        // TODO: Rename this to... something better.
        //一个是计算异步更新的过期时间
        expirationTime = computeAsyncExpiration(currentTime);
        break;
      case IdlePriority:
        expirationTime = Never;
        break;
      default:
        invariant(false, 'Expected a valid priority level');
    }
  }

  // If we're in the middle of rendering a tree, do not update at the same
  // expiration time that is already rendering.
  // TODO: We shouldn't have to do this if the update is on a different root.
  // Refactor computeExpirationForFiber + scheduleUpdate so we have access to
  // the root when we check for this condition.
  if (workInProgressRoot !== null && expirationTime === renderExpirationTime) {
    // This is a trick to move this update into a separate batch
    expirationTime -= 1;
  }

  return expirationTime;
}

let lastUniqueAsyncExpiration = NoWork;
export function computeUniqueAsyncExpiration(): ExpirationTime {
  const currentTime = requestCurrentTime();
  let result = computeAsyncExpiration(currentTime);
  if (result <= lastUniqueAsyncExpiration) {
    // Since we assume the current time monotonically increases, we only hit
    // this branch when computeUniqueAsyncExpiration is fired multiple times
    // within a 200ms window (or whatever the async bucket size is).
    result -= 1;
  }
  lastUniqueAsyncExpiration = result;
  return result;
}
//scheduleWork
export function scheduleUpdateOnFiber(
  fiber: Fiber,
  expirationTime: ExpirationTime,
) {
  //判断是否是无限循环update
  checkForNestedUpdates();
  //测试环境用的，不看
  warnAboutInvalidUpdatesOnClassComponentsInDEV(fiber);
  //找到rootFiber并遍历更新子节点的expirationTime
  const root = markUpdateTimeFromFiberToRoot(fiber, expirationTime);
  if (root === null) {
    warnAboutUpdateOnUnmountedFiberInDEV(fiber);
    return;
  }
  //NoWork表示无更新操作
  root.pingTime = NoWork;
  //判断是否有高优先级任务打断当前正在执行的任务
  checkForInterruption(fiber, expirationTime);
  //报告调度更新，测试环境用的，可不看
  recordScheduleUpdate();

  // TODO: computeExpirationForFiber also reads the priority. Pass the
  // priority as an argument to that function and this one.
  const priorityLevel = getCurrentPriorityLevel();
  //1073741823
  //如果expirationTime等于最大整型值的话
  //如果是同步任务的过期时间的话
  if (expirationTime === Sync) {
    //如果还未渲染，update是未分批次的，
    //也就是第一次渲染前
    if (
      // Check if we're inside unbatchedUpdates
      (executionContext & LegacyUnbatchedContext) !== NoContext &&
      // Check if we're not already rendering
      (executionContext & (RenderContext | CommitContext)) === NoContext
    ) {
      // Register pending interactions on the root to avoid losing traced interaction data.
      //跟踪这些update，并计数、检测它们是否会报错
      schedulePendingInteractions(root, expirationTime);

      // This is a legacy edge case. The initial mount of a ReactDOM.render-ed
      // root inside of batchedUpdates should be synchronous, but layout updates
      // should be deferred until the end of the batch.
      //批量更新时，render是要保持同步的，但布局的更新要延迟到批量更新的末尾才执行

      //初始化root
      //调用workLoop进行循环单元更新
      let callback = renderRoot(root, Sync, true);
      while (callback !== null) {
        callback = callback(true);
      }
    }
    //render后
    else {
      //立即执行调度任务
      scheduleCallbackForRoot(root, ImmediatePriority, Sync);
      //当前没有update时
      if (executionContext === NoContext) {
        // Flush the synchronous work now, wnless we're already working or inside
        // a batch. This is intentionally inside scheduleUpdateOnFiber instead of
        // scheduleCallbackForFiber to preserve the ability to schedule a callback
        // without immediately flushing it. We only do this for user-initated
        // updates, to preserve historical behavior of sync mode.
        //刷新同步任务队列
        flushSyncCallbackQueue();
      }
    }
  }
  //如果是异步任务的话，则立即执行调度任务
  else {
    scheduleCallbackForRoot(root, priorityLevel, expirationTime);
  }

  if (
    (executionContext & DiscreteEventContext) !== NoContext &&
    // Only updates at user-blocking priority or greater are considered
    // discrete, even inside a discrete event.
    // 只有在用户阻止优先级或更高优先级的更新才被视为离散，即使在离散事件中也是如此
    (priorityLevel === UserBlockingPriority ||
      priorityLevel === ImmediatePriority)
  ) {
    // This is the result of a discrete event. Track the lowest priority
    // discrete update per root so we can flush them early, if needed.
    //这是离散事件的结果。 跟踪每个根的最低优先级离散更新，以便我们可以在需要时尽早清除它们。
    //如果rootsWithPendingDiscreteUpdates为null，则初始化它
    if (rootsWithPendingDiscreteUpdates === null) {
      //key是root，value是expirationTime
      rootsWithPendingDiscreteUpdates = new Map([[root, expirationTime]]);
    } else {
      //获取最新的DiscreteTime
      const lastDiscreteTime = rootsWithPendingDiscreteUpdates.get(root);
      //更新DiscreteTime
      if (lastDiscreteTime === undefined || lastDiscreteTime > expirationTime) {
        rootsWithPendingDiscreteUpdates.set(root, expirationTime);
      }
    }
  }
}
export const scheduleWork = scheduleUpdateOnFiber;

// This is split into a separate function so we can mark a fiber with pending
// work without treating it as a typical update that originates from an event;
// e.g. retrying a Suspense boundary isn't an update, but it does schedule work
// on a fiber.

//目标fiber会向上寻找rootFiber对象，在寻找的过程中会进行一些操作
function markUpdateTimeFromFiberToRoot(fiber, expirationTime) {
  // Update the source fiber's expiration time
  //如果fiber对象的过期时间小于 expirationTime，则更新fiber对象的过期时间

  //也就是说，当前fiber的优先级是小于expirationTime的优先级的，现在要调高fiber的优先级
  if (fiber.expirationTime < expirationTime) {
    fiber.expirationTime = expirationTime;
  }
  //在enqueueUpdate()中有讲到，与fiber.current是映射关系
  let alternate = fiber.alternate;
  //同上
  if (alternate !== null && alternate.expirationTime < expirationTime) {
    alternate.expirationTime = expirationTime;
  }
  // Walk the parent path to the root and update the child expiration time.
  //向上遍历父节点，直到root节点，在遍历的过程中更新子节点的expirationTime

  //fiber的父节点
  let node = fiber.return;
  let root = null;
  //node=null,表示是没有父节点了，也就是到达了RootFiber，即最大父节点
  //HostRoot即树的顶端节点root
  if (node === null && fiber.tag === HostRoot) {
    //RootFiber的stateNode就是FiberRoot
    root = fiber.stateNode;
  }
  //没有到达FiberRoot的话，则进行循环
  else {
    while (node !== null) {
      alternate = node.alternate;
      //如果父节点的所有子节点中优先级最高的更新时间仍小于expirationTime的话
      //则提高优先级
      if (node.childExpirationTime < expirationTime) {
        //重新赋值
        node.childExpirationTime = expirationTime;
        //alternate是相对于fiber的另一个对象，也要进行更新
        if (
          alternate !== null &&
          alternate.childExpirationTime < expirationTime
        ) {
          alternate.childExpirationTime = expirationTime;
        }
      }
      //别看差了是对应(node.childExpirationTime < expirationTime)的if
      else if (
        alternate !== null &&
        alternate.childExpirationTime < expirationTime
      ) {
        alternate.childExpirationTime = expirationTime;
      }
      //如果找到顶端rootFiber，结束循环
      if (node.return === null && node.tag === HostRoot) {
        root = node.stateNode;
        break;
      }
      node = node.return;
    }
  }
  //更新该rootFiber的最旧、最新的挂起时间
  /*和 16.6.0 的addRootToSchedule相似*/
  if (root !== null) {
    // Update the first and last pending expiration times in this root
    const firstPendingTime = root.firstPendingTime;
    if (expirationTime > firstPendingTime) {
      root.firstPendingTime = expirationTime;
    }
    const lastPendingTime = root.lastPendingTime;
    if (lastPendingTime === NoWork || expirationTime < lastPendingTime) {
      root.lastPendingTime = expirationTime;
    }
  }

  return root;
}

// Use this function, along with runRootCallback, to ensure that only a single
// callback per root is scheduled. It's still possible to call renderRoot
// directly, but scheduling via this function helps avoid excessive callbacks.
// It works by storing the callback node and expiration time on the root. When a
// new callback comes in, it compares the expiration time to determine if it
// should cancel the previous one. It also relies on commitRoot scheduling a
// callback to render the next level, because that means we don't need a
// separate callback per expiration time.
//同步调用callback
//流程是在root上存取callback和expirationTime，
// 当新的callback调用时，比较更新expirationTime
function scheduleCallbackForRoot(
  root: FiberRoot,
  priorityLevel: ReactPriorityLevel,
  expirationTime: ExpirationTime,
) {
  //获取root的回调过期时间
  const existingCallbackExpirationTime = root.callbackExpirationTime;
  //更新root的回调过期时间
  if (existingCallbackExpirationTime < expirationTime) {
    // New callback has higher priority than the existing one.
    //当新的expirationTime比已存在的callback的expirationTime优先级更高的时候
    const existingCallbackNode = root.callbackNode;
    if (existingCallbackNode !== null) {
      //取消已存在的callback（打断）
      //将已存在的callback节点从链表中移除
      cancelCallback(existingCallbackNode);
    }
    //更新callbackExpirationTime
    root.callbackExpirationTime = expirationTime;
    //如果是同步任务
    if (expirationTime === Sync) {
      // Sync React callbacks are scheduled on a special internal queue
      //在临时队列中同步被调度的callback
      /*16.6.0 performSyncWork()*/
      /*同步执行 react 代码，会一直执行到结束，无法被打断*/
      root.callbackNode = scheduleSyncCallback(
        runRootCallback.bind(
          null,
          root,
          renderRoot.bind(null, root, expirationTime),
        ),
      );
    } else {
      let options = null;
      if (expirationTime !== Never) {
        //(Sync-2 - expirationTime) * 10-now()
        let timeout = expirationTimeToMs(expirationTime) - now();
        options = {timeout};
      }
      //callbackNode即经过处理包装的新task
      /*16.6.0 scheduleCallbackWithExpirationTime*/
      /*浏览器有空闲的情况下去执行一些普通任务，并且设置 deadline，在 deadline 之前可以执行，
      * 在 deadline 之后，把执行权交还给浏览器*/
      root.callbackNode = scheduleCallback(
        priorityLevel,
        //bind()的意思是绑定this，xx.bind(y)()这样才算执行
        runRootCallback.bind(
          null,
          root,
          renderRoot.bind(null, root, expirationTime),
        ),
        options,
      );
      if (
        enableUserTimingAPI &&
        expirationTime !== Sync &&
        (executionContext & (RenderContext | CommitContext)) === NoContext
      ) {
        // Scheduled an async callback, and we're not already working. Add an
        // entry to the flamegraph that shows we're waiting for a callback
        // to fire.
        //开始调度callback的标志
        startRequestCallbackTimer();
      }
    }
  }

  // Associate the current interactions with this new root+priority.
  //跟踪这些update，并计数、检测它们是否会报错
  schedulePendingInteractions(root, expirationTime);
}

// null, root, renderRoot.bind(null, root, expirationTime),
function runRootCallback(root, callback, isSync) {
  const prevCallbackNode = root.callbackNode;
  let continuation = null;
  try {
    continuation = callback(isSync);
    if (continuation !== null) {
      return runRootCallback.bind(null, root, continuation);
    } else {
      return null;
    }
  } finally {
    // If the callback exits without returning a continuation, remove the
    // corresponding callback node from the root. Unless the callback node
    // has changed, which implies that it was already cancelled by a high
    // priority update.
    if (continuation === null && prevCallbackNode === root.callbackNode) {
      root.callbackNode = null;
      root.callbackExpirationTime = NoWork;
    }
  }
}

export function flushRoot(root: FiberRoot, expirationTime: ExpirationTime) {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    invariant(
      false,
      'work.commit(): Cannot commit while already rendering. This likely ' +
        'means you attempted to commit from inside a lifecycle method.',
    );
  }
  scheduleSyncCallback(renderRoot.bind(null, root, expirationTime));
  flushSyncCallbackQueue();
}

export function flushDiscreteUpdates() {
  // TODO: Should be able to flush inside batchedUpdates, but not inside `act`.
  // However, `act` uses `batchedUpdates`, so there's no way to distinguish
  // those two cases. Need to fix this before exposing flushDiscreteUpdates
  // as a public API.
  if (
    (executionContext & (BatchedContext | RenderContext | CommitContext)) !==
    NoContext
  ) {
    if (__DEV__ && (executionContext & RenderContext) !== NoContext) {
      warning(
        false,
        'unstable_flushDiscreteUpdates: Cannot flush updates when React is ' +
          'already rendering.',
      );
    }
    // We're already rendering, so we can't synchronously flush pending work.
    // This is probably a nested event dispatch triggered by a lifecycle/effect,
    // like `el.focus()`. Exit.
    return;
  }
  flushPendingDiscreteUpdates();
  if (!revertPassiveEffectsChange) {
    // If the discrete updates scheduled passive effects, flush them now so that
    // they fire before the next serial event.
    flushPassiveEffects();
  }
}

function resolveLocksOnRoot(root: FiberRoot, expirationTime: ExpirationTime) {
  const firstBatch = root.firstBatch;
  if (
    firstBatch !== null &&
    firstBatch._defer &&
    firstBatch._expirationTime >= expirationTime
  ) {
    scheduleCallback(NormalPriority, () => {
      firstBatch._onComplete();
      return null;
    });
    return true;
  } else {
    return false;
  }
}
//延缓更新
export function deferredUpdates<A>(fn: () => A): A {
  // TODO: Remove in favor of Scheduler.next
  //
  return runWithPriority(NormalPriority, fn);
}
//同步更新
export function syncUpdates<A, B, C, R>(
  fn: (A, B, C) => R,
  a: A,
  b: B,
  c: C,
): R {
  //fn就是setState
  return runWithPriority(ImmediatePriority, fn.bind(null, a, b, c));
}

function flushPendingDiscreteUpdates() {
  if (rootsWithPendingDiscreteUpdates !== null) {
    // For each root with pending discrete updates, schedule a callback to
    // immediately flush them.
    const roots = rootsWithPendingDiscreteUpdates;
    rootsWithPendingDiscreteUpdates = null;
    roots.forEach((expirationTime, root) => {
      scheduleSyncCallback(renderRoot.bind(null, root, expirationTime));
    });
    // Now flush the immediate queue.
    flushSyncCallbackQueue();
  }
}

export function batchedUpdates<A, R>(fn: A => R, a: A): R {
  const prevExecutionContext = executionContext;
  //按位或，executionContext 始终不为 null
  executionContext |= BatchedContext;
  try {
    //调用回调函数
    return fn(a);
  } finally {
    executionContext = prevExecutionContext;
    if (executionContext === NoContext) {
      // Flush the immediate callbacks that were scheduled during this batch
      //替代 requestWork 的功能
      flushSyncCallbackQueue();
    }
  }
}

export function batchedEventUpdates<A, R>(fn: A => R, a: A): R {
  const prevExecutionContext = executionContext;
  executionContext |= EventContext;
  try {
    return fn(a);
  } finally {
    executionContext = prevExecutionContext;
    if (executionContext === NoContext) {
      // Flush the immediate callbacks that were scheduled during this batch
      flushSyncCallbackQueue();
    }
  }
}

export function discreteUpdates<A, B, C, R>(
  fn: (A, B, C) => R,
  a: A,
  b: B,
  c: C,
): R {
  const prevExecutionContext = executionContext;
  executionContext |= DiscreteEventContext;
  try {
    // Should this
    return runWithPriority(UserBlockingPriority, fn.bind(null, a, b, c));
  } finally {
    executionContext = prevExecutionContext;
    if (executionContext === NoContext) {
      // Flush the immediate callbacks that were scheduled during this batch
      flushSyncCallbackQueue();
    }
  }
}

export function unbatchedUpdates<A, R>(fn: (a: A) => R, a: A): R {
  const prevExecutionContext = executionContext;
  executionContext &= ~BatchedContext;
  executionContext |= LegacyUnbatchedContext;
  try {
    return fn(a);
  } finally {
    executionContext = prevExecutionContext;
    if (executionContext === NoContext) {
      // Flush the immediate callbacks that were scheduled during this batch
      flushSyncCallbackQueue();
    }
  }
}

export function flushSync<A, R>(fn: A => R, a: A): R {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    invariant(
      false,
      'flushSync was called from inside a lifecycle method. It cannot be ' +
        'called when React is already rendering.',
    );
  }
  const prevExecutionContext = executionContext;
  executionContext |= BatchedContext;
  try {
    //syncUpdates 是return runWithPriority(ImmediatePriority, fn.bind(null, a, b, c));
    //相当于调用了syncUpdates(fn,a)
    return runWithPriority(ImmediatePriority, fn.bind(null, a));
  } finally {
    executionContext = prevExecutionContext;
    // Flush the immediate callbacks that were scheduled during this batch.
    // Note that this will happen even if batchedUpdates is higher up
    // the stack.
    flushSyncCallbackQueue();
  }
}

export function flushControlled(fn: () => mixed): void {
  const prevExecutionContext = executionContext;
  executionContext |= BatchedContext;
  try {
    runWithPriority(ImmediatePriority, fn);
  } finally {
    executionContext = prevExecutionContext;
    if (executionContext === NoContext) {
      // Flush the immediate callbacks that were scheduled during this batch
      flushSyncCallbackQueue();
    }
  }
}

//重置调度队列,并从新插入的节点开始调度
function prepareFreshStack(root, expirationTime) {
  /*属性的详细解释见文章 fiberRoot*/
  //finishedWork:已经完成任务的FiberRoot对象
  root.finishedWork = null;
  //finishedExpirationTime:当前更新对应的过期时间
  root.finishedExpirationTime = NoWork;
  //timeout 后 执行的函数
  const timeoutHandle = root.timeoutHandle;
  //如果该root 之前被挂起过，并且使用 timeout调度过的话，取消timeoutHandle
  if (timeoutHandle !== noTimeout) {
    // The root previous suspended and scheduled a timeout to commit a fallback
    // state. Now that we have additional work, cancel the timeout.
    root.timeoutHandle = noTimeout;
    // $FlowFixMe Complains noTimeout is not a TimeoutID, despite the check above
    cancelTimeout(timeoutHandle);
  }
  //workInProgress:current的引用,current 也就是 root 对应的 fiber 对象
  if (workInProgress !== null) {
    //root 对应的 fiber 对象的父对象
    let interruptedWork = workInProgress.return;
    //当 root 并不是 fiber 树的根对象时
    while (interruptedWork !== null) {
      unwindInterruptedWork(interruptedWork);
      interruptedWork = interruptedWork.return;
    }
  }
  /*重置当前正要处理的节点*/
  //将当前将要执行的节点设为 root 节点
  workInProgressRoot = root;
  //复制root.current并赋值给workInProgress
  //在当前节点上直接做处理的话，会影响页面的渲染
  workInProgress = createWorkInProgress(root.current, null, expirationTime);
  renderExpirationTime = expirationTime;
  workInProgressRootExitStatus = RootIncomplete;
  workInProgressRootLatestProcessedExpirationTime = Sync;
  workInProgressRootLatestSuspenseTimeout = Sync;
  workInProgressRootCanSuspendUsingConfig = null;
  workInProgressRootHasPendingPing = false;

  if (enableSchedulerTracing) {
    spawnedWorkDuringRender = null;
  }

  if (__DEV__) {
    ReactStrictModeWarnings.discardPendingWarnings();
    componentsWithSuspendedDiscreteUpdates = null;
  }
}

// 1.调用 workLoop 进行循环单元更新
// 2.捕获错误并进行处理
// 3.走完流程后，针对不同的结果进行不同的处理===================================
function renderRoot(
  root: FiberRoot,
  expirationTime: ExpirationTime,
  isSync: boolean,
): SchedulerCallback | null {
  invariant(
    (executionContext & (RenderContext | CommitContext)) === NoContext,
    'Should not already be working.',
  );

  if (enableUserTimingAPI && expirationTime !== Sync) {
    const didExpire = isSync;
    stopRequestCallbackTimer(didExpire);
  }

  if (root.firstPendingTime < expirationTime) {
    // If there's no work left at this expiration time, exit immediately. This
    // happens when multiple callbacks are scheduled for a single root, but an
    // earlier callback flushes the work of a later one.
    return null;
  }

  if (isSync && root.finishedExpirationTime === expirationTime) {
    // There's already a pending commit at this expiration time.
    // TODO: This is poorly factored. This case only exists for the
    // batch.commit() API.
    return commitRoot.bind(null, root);
  }
  // 听说是useEffect的调用
  flushPassiveEffects();

  // If the root or expiration time have changed, throw out the existing stack
  // and prepare a fresh one. Otherwise we'll continue where we left off.

  /*nextRoot =》 workInProgressRoot*/
  /*nextRenderExpirationTime =》 renderExpirationTime*/
  //workInProgressRoot 指接下来要更新的节点
  //renderExpirationTime 指接下来更新节点的过期时间
  //意思就是当前要更新的节点并非是队列中要更新的节点，也就是说被新的高优先级的任务给打断了
  if (root !== workInProgressRoot || expirationTime !== renderExpirationTime) {
    //重置调度队列,并从root节点(新的高优先级的节点)开始调度
    /*resetStack <=> prepareFreshStack */
    prepareFreshStack(root, expirationTime);
    //将调度优先级高的interaction加入到interactions中
    startWorkOnPendingInteractions(root, expirationTime);
  }
  //应该是当已经接收一个低优先级的要更新的节点时所进行的操作
  else if (workInProgressRootExitStatus === RootSuspendedWithDelay) {
    // We could've received an update at a lower priority while we yielded.
    // We're suspended in a delayed state. Once we complete this render we're
    // just going to try to recover at the last pending time anyway so we might
    // as well start doing that eagerly.
    // Ideally we should be able to do this even for retries but we don't yet
    // know if we're going to process an update which wants to commit earlier,
    // and this path happens very early so it would happen too often. Instead,
    // for that case, we'll wait until we complete.
    if (workInProgressRootHasPendingPing) {
      // We have a ping at this expiration. Let's restart to see if we get unblocked.
      prepareFreshStack(root, expirationTime);
    } else {
      const lastPendingTime = root.lastPendingTime;
      if (lastPendingTime < expirationTime) {
        // There's lower priority work. It might be unsuspended. Try rendering
        // at that level immediately, while preserving the position in the queue.
        return renderRoot.bind(null, root, lastPendingTime);
      }
    }
  }

  // If we have a work-in-progress fiber, it means there's still work to do
  // in this root.
  if (workInProgress !== null) {
    const prevExecutionContext = executionContext;
    executionContext |= RenderContext;
    let prevDispatcher = ReactCurrentDispatcher.current;
    if (prevDispatcher === null) {
      // The React isomorphic package does not include a default dispatcher.
      // Instead the first renderer will lazily attach one, in order to give
      // nicer error messages.
      prevDispatcher = ContextOnlyDispatcher;
    }
    ReactCurrentDispatcher.current = ContextOnlyDispatcher;
    let prevInteractions: Set<Interaction> | null = null;
    if (enableSchedulerTracing) {
      prevInteractions = __interactionsRef.current;
      __interactionsRef.current = root.memoizedInteractions;
    }
    //绑定 currentFiber，也标志着开始执行 workloop
    startWorkLoopTimer(workInProgress);

    // TODO: Fork renderRoot into renderRootSync and renderRootAsync
    //如果是同步的话
    if (isSync) {
      //如果更新时间是异步的话
      if (expirationTime !== Sync) {
        // An async update expired. There may be other expired updates on
        // this root. We should render all the expired work in a
        // single batch.

        //将所有过期的时间分批次处理
        const currentTime = requestCurrentTime();
        if (currentTime < expirationTime) {
          // Restart at the current time.
          executionContext = prevExecutionContext;
          resetContextDependencies();
          ReactCurrentDispatcher.current = prevDispatcher;
          if (enableSchedulerTracing) {
            __interactionsRef.current = ((prevInteractions: any): Set<
              Interaction,
            >);
          }
          return renderRoot.bind(null, root, currentTime);
        }
      }
    } else {
      // Since we know we're in a React event, we can clear the current
      // event time. The next update will compute a new event time.

      //清除currentEventTime
      currentEventTime = NoWork;
    }

    do {
      try {
        //执行每个节点的更新
        if (isSync) {
          workLoopSync();
        } else {
          //判断是否需要继续调用performUnitOfWork
          workLoop();
        }

        break;
      }
      //==========================================捕获异常，并处理================================================================
      catch (thrownValue)
      {
        // Reset module-level state that was set during the render phase.
        //重置状态
        resetContextDependencies();
        // 重置 hooks 状态
        resetHooks();

        const sourceFiber = workInProgress;
        /*nextUnitOfWork <=> sourceFiber*/
        //如果sourceFiber是存在的，那么 React 可以判断错误的原因
        //如果sourceFiber是不存在的，说明是未知错误
        if (sourceFiber === null || sourceFiber.return === null) {
          // Expected to be working on a non-root fiber. This is a fatal error
          // because there's no ancestor that can handle it; the root is
          // supposed to capture all errors that weren't caught by an error
          // boundary.
          //重置调度队列,并从root节点(新的高优先级的节点)开始调度
          prepareFreshStack(root, expirationTime);
          executionContext = prevExecutionContext;
          //抛出错误
          throw thrownValue;
        }
        //记录error被捕获前，渲染所花费的时间
        //这样可以避免在渲染挂起(暂停)的情况下，Profiler的时间会不准确

        //Profiler：测量渲染一个 React 应用多久渲染一次以及渲染一次的“代价”。
        //它的目的是识别出应用中渲染较慢的部分，或是可以使用类似 memoization 优化的部分，并从相关优化中获益。
        if (enableProfilerTimer && sourceFiber.mode & ProfileMode) {
          // Record the time spent rendering before an error was thrown. This
          // avoids inaccurate Profiler durations in the case of a
          // suspended render.
          stopProfilerTimerIfRunningAndRecordDelta(sourceFiber, true);
        }
        //获取父节点
        const returnFiber = sourceFiber.return;
        //抛出可预期的错误
        throwException(
          root,
          returnFiber,
          sourceFiber,
          thrownValue,
          renderExpirationTime,
        );
        //完成对sourceFiber的渲染，
        //但是因为已经是报错的，所以不会再渲染sourceFiber的子节点了
        //sourceFiber 即报错的节点
        workInProgress = completeUnitOfWork(sourceFiber);
      }
      //=============================================================================================================================================
    } while (true);

    executionContext = prevExecutionContext;
    //重置状态
    resetContextDependencies();
    ReactCurrentDispatcher.current = prevDispatcher;
    if (enableSchedulerTracing) {
      __interactionsRef.current = ((prevInteractions: any): Set<Interaction>);
    }
    //如果仍有正在进程里的任务
    if (workInProgress !== null) {
      // There's still work left over. Return a continuation.
      //停止计时
      stopInterruptedWorkLoopTimer();
      if (expirationTime !== Sync) {
        //开始调度callback的标志
        startRequestCallbackTimer();
      }
      //绑定 this
      return renderRoot.bind(null, root, expirationTime);
    }
  }

  // We now have a consistent tree. The next step is either to commit it, or, if
  // something suspended, wait to commit it after a timeout.
  // 至此，保证了 fiber 树的每个节点的状态都是一致的。接下来会执行 commit 步骤/或者是又有新的任务被挂起了，等待挂起结束再去 commit
  stopFinishedWorkLoopTimer();

  root.finishedWork = root.current.alternate;
  root.finishedExpirationTime = expirationTime;
  //判断当前节点是否被阻止commit
  const isLocked = resolveLocksOnRoot(root, expirationTime);
  //如果有，则退出
  if (isLocked) {
    // This root has a lock that prevents it from committing. Exit. If we begin
    // work on the root again, without any intervening updates, it will finish
    // without doing additional work.
    return null;
  }

  // Set this to null to indicate there's no in-progress render.
  //将workInProgressRoot以告诉 react 没有正在 render 的进程
  workInProgressRoot = null;
  //根据workInProgressRoot的不同状态来进行不同的操作
  switch (workInProgressRootExitStatus) {
    case RootIncomplete: {
      invariant(false, 'Should have a work-in-progress.');
    }
    // Flow knows about invariant, so it compains if I add a break statement,
    // but eslint doesn't know about invariant, so it complains if I do.
    //对下面 eslint 注释的解释，可不看
    // eslint-disable-next-line no-fallthrough
    case RootErrored: {
      // An error was thrown. First check if there is lower priority work
      // scheduled on this root.
      const lastPendingTime = root.lastPendingTime;
      if (lastPendingTime < expirationTime) {
        // There's lower priority work. Before raising the error, try rendering
        // at the lower priority to see if it fixes it. Use a continuation to
        // maintain the existing priority and position in the queue.
        return renderRoot.bind(null, root, lastPendingTime);
      }
      if (!isSync) {
        // If we're rendering asynchronously, it's possible the error was
        // caused by tearing due to a mutation during an event. Try rendering
        // one more time without yiedling to events.
        prepareFreshStack(root, expirationTime);
        scheduleSyncCallback(renderRoot.bind(null, root, expirationTime));
        return null;
      }
      // If we're already rendering synchronously, commit the root in its
      // errored state.
      return commitRoot.bind(null, root);
    }
    case RootSuspended: {
      // We have an acceptable loading state. We need to figure out if we should
      // immediately commit it or wait a bit.

      // If we have processed new updates during this render, we may now have a
      // new loading state ready. We want to ensure that we commit that as soon as
      // possible.
      const hasNotProcessedNewUpdates =
        workInProgressRootLatestProcessedExpirationTime === Sync;
      if (hasNotProcessedNewUpdates && !isSync) {
        // If we have not processed any new updates during this pass, then this is
        // either a retry of an existing fallback state or a hidden tree.
        // Hidden trees shouldn't be batched with other work and after that's
        // fixed it can only be a retry.
        // We're going to throttle committing retries so that we don't show too
        // many loading states too quickly.
        let msUntilTimeout =
          globalMostRecentFallbackTime + FALLBACK_THROTTLE_MS - now();
        // Don't bother with a very short suspense time.
        if (msUntilTimeout > 10) {
          if (workInProgressRootHasPendingPing) {
            // This render was pinged but we didn't get to restart earlier so try
            // restarting now instead.
            prepareFreshStack(root, expirationTime);
            return renderRoot.bind(null, root, expirationTime);
          }
          const lastPendingTime = root.lastPendingTime;
          if (lastPendingTime < expirationTime) {
            // There's lower priority work. It might be unsuspended. Try rendering
            // at that level.
            return renderRoot.bind(null, root, lastPendingTime);
          }
          // The render is suspended, it hasn't timed out, and there's no lower
          // priority work to do. Instead of committing the fallback
          // immediately, wait for more data to arrive.
          root.timeoutHandle = scheduleTimeout(
            commitRoot.bind(null, root),
            msUntilTimeout,
          );
          return null;
        }
      }
      // The work expired. Commit immediately.
      return commitRoot.bind(null, root);
    }
    case RootSuspendedWithDelay: {
      if (!isSync) {
        // We're suspended in a state that should be avoided. We'll try to avoid committing
        // it for as long as the timeouts let us.
        if (workInProgressRootHasPendingPing) {
          // This render was pinged but we didn't get to restart earlier so try
          // restarting now instead.
          prepareFreshStack(root, expirationTime);
          return renderRoot.bind(null, root, expirationTime);
        }
        const lastPendingTime = root.lastPendingTime;
        if (lastPendingTime < expirationTime) {
          // There's lower priority work. It might be unsuspended. Try rendering
          // at that level immediately.
          return renderRoot.bind(null, root, lastPendingTime);
        }

        let msUntilTimeout;
        if (workInProgressRootLatestSuspenseTimeout !== Sync) {
          // We have processed a suspense config whose expiration time we can use as
          // the timeout.
          msUntilTimeout =
            expirationTimeToMs(workInProgressRootLatestSuspenseTimeout) - now();
        } else if (workInProgressRootLatestProcessedExpirationTime === Sync) {
          // This should never normally happen because only new updates cause
          // delayed states, so we should have processed something. However,
          // this could also happen in an offscreen tree.
          msUntilTimeout = 0;
        } else {
          // If we don't have a suspense config, we're going to use a heuristic to
          // determine how long we can suspend.
          const eventTimeMs: number = inferTimeFromExpirationTime(
            workInProgressRootLatestProcessedExpirationTime,
          );
          const currentTimeMs = now();
          const timeUntilExpirationMs =
            expirationTimeToMs(expirationTime) - currentTimeMs;
          let timeElapsed = currentTimeMs - eventTimeMs;
          if (timeElapsed < 0) {
            // We get this wrong some time since we estimate the time.
            timeElapsed = 0;
          }

          msUntilTimeout = jnd(timeElapsed) - timeElapsed;

          // Clamp the timeout to the expiration time.
          // TODO: Once the event time is exact instead of inferred from expiration time
          // we don't need this.
          if (timeUntilExpirationMs < msUntilTimeout) {
            msUntilTimeout = timeUntilExpirationMs;
          }
        }

        // Don't bother with a very short suspense time.
        if (msUntilTimeout > 10) {
          // The render is suspended, it hasn't timed out, and there's no lower
          // priority work to do. Instead of committing the fallback
          // immediately, wait for more data to arrive.
          root.timeoutHandle = scheduleTimeout(
            commitRoot.bind(null, root),
            msUntilTimeout,
          );
          return null;
        }
      }
      // The work expired. Commit immediately.
      return commitRoot.bind(null, root);
    }
    case RootCompleted: {
      // The work completed. Ready to commit.
      if (
        !isSync &&
        workInProgressRootLatestProcessedExpirationTime !== Sync &&
        workInProgressRootCanSuspendUsingConfig !== null
      ) {
        // If we have exceeded the minimum loading delay, which probably
        // means we have shown a spinner already, we might have to suspend
        // a bit longer to ensure that the spinner is shown for enough time.
        const msUntilTimeout = computeMsUntilSuspenseLoadingDelay(
          workInProgressRootLatestProcessedExpirationTime,
          expirationTime,
          workInProgressRootCanSuspendUsingConfig,
        );
        if (msUntilTimeout > 10) {
          root.timeoutHandle = scheduleTimeout(
            commitRoot.bind(null, root),
            msUntilTimeout,
          );
          return null;
        }
      }
      return commitRoot.bind(null, root);
    }
    default: {
      invariant(false, 'Unknown root exit status.');
    }
  }
}
//==============================================================

export function markCommitTimeOfFallback() {
  globalMostRecentFallbackTime = now();
}

export function markRenderEventTimeAndConfig(
  expirationTime: ExpirationTime,
  suspenseConfig: null | SuspenseConfig,
): void {
  if (
    expirationTime < workInProgressRootLatestProcessedExpirationTime &&
    expirationTime > Never
  ) {
    workInProgressRootLatestProcessedExpirationTime = expirationTime;
  }
  if (suspenseConfig !== null) {
    if (
      expirationTime < workInProgressRootLatestSuspenseTimeout &&
      expirationTime > Never
    ) {
      workInProgressRootLatestSuspenseTimeout = expirationTime;
      // Most of the time we only have one config and getting wrong is not bad.
      workInProgressRootCanSuspendUsingConfig = suspenseConfig;
    }
  }
}

export function renderDidSuspend(): void {
  if (workInProgressRootExitStatus === RootIncomplete) {
    workInProgressRootExitStatus = RootSuspended;
  }
}

export function renderDidSuspendDelayIfPossible(): void {
  if (
    workInProgressRootExitStatus === RootIncomplete ||
    workInProgressRootExitStatus === RootSuspended
  ) {
    workInProgressRootExitStatus = RootSuspendedWithDelay;
  }
}

export function renderDidError() {
  if (workInProgressRootExitStatus !== RootCompleted) {
    workInProgressRootExitStatus = RootErrored;
  }
}

// Called during render to determine if anything has suspended.
// Returns false if we're not sure.
export function renderHasNotSuspendedYet(): boolean {
  // If something errored or completed, we can't really be sure,
  // so those are false.
  return workInProgressRootExitStatus === RootIncomplete;
}

function inferTimeFromExpirationTime(expirationTime: ExpirationTime): number {
  // We don't know exactly when the update was scheduled, but we can infer an
  // approximate start time from the expiration time.
  const earliestExpirationTimeMs = expirationTimeToMs(expirationTime);
  return earliestExpirationTimeMs - LOW_PRIORITY_EXPIRATION;
}

function inferTimeFromExpirationTimeWithSuspenseConfig(
  expirationTime: ExpirationTime,
  suspenseConfig: SuspenseConfig,
): number {
  // We don't know exactly when the update was scheduled, but we can infer an
  // approximate start time from the expiration time by subtracting the timeout
  // that was added to the event time.
  const earliestExpirationTimeMs = expirationTimeToMs(expirationTime);
  return (
    earliestExpirationTimeMs -
    (suspenseConfig.timeoutMs | 0 || LOW_PRIORITY_EXPIRATION)
  );
}

//同步的 workLoop，说明是不可以被中断的
function workLoopSync() {
  // Already timed out, so perform work without checking if we need to yield.
  while (workInProgress !== null) {
    workInProgress = performUnitOfWork(workInProgress);
  }
}

//异步的 workLoop，说明是可以被中断的
//判断是否需要继续调用performUnitOfWork
function workLoop() {
  // Perform work until Scheduler asks us to yield
  /*nextUnitOfWork =》workInProgress*/
  //未到达根节点时

  //有workInProgress.child的时候，一直循环，直到所有节点更新完毕
  while (workInProgress !== null && !shouldYield()) {
    workInProgress = performUnitOfWork(workInProgress);
  }
}

//从上至下遍历、操作节点，至底层后，再从下至上，根据 effectTag，对节点进行一些处理
//unitOfWork 即 workInProgress，是一个 fiber 对象
function performUnitOfWork(unitOfWork: Fiber): Fiber | null {
  // The current, flushed, state of this fiber is the alternate. Ideally
  // nothing should rely on this, but relying on it here means that we don't
  // need an additional field on the work in progress.
  //current <=> workInProgress
  //获取当前节点
  const current = unitOfWork.alternate;
  //在unitOfWork上做个标记，不看
  startWorkTimer(unitOfWork);
  //dev 环境，不看
  setCurrentDebugFiberInDEV(unitOfWork);

  let next;
  if (enableProfilerTimer && (unitOfWork.mode & ProfileMode) !== NoMode) {
    startProfilerTimer(unitOfWork);
    //进行节点操作，并创建子节点
    //current: workInProgress.alternate
    //unitOfWork: workInProgress

    //workInProgress.child
    //判断节点有无更新，有更新则进行相应的组件更新，无更新则复制节点
    next = beginWork(current, unitOfWork, renderExpirationTime);
    stopProfilerTimerIfRunningAndRecordDelta(unitOfWork, true);
  } else {
    next = beginWork(current, unitOfWork, renderExpirationTime);
  }
  //不看
  resetCurrentDebugFiberInDEV();
  //将待更新的 props 替换成正在用的 props
  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  //说明已经更新到了最底层的叶子节点，并且叶子节点的兄弟节点也已经遍历完
  if (next === null) {
    // If this doesn't spawn new work, complete the current work.
    //当从上到下遍历完成后，completeUnitOfWork 会从下到上根据effectTag进行一些处理
    next = completeUnitOfWork(unitOfWork);
  }

  ReactCurrentOwner.current = null;
  return next;
}

//完成当前节点的 work，然后移动到兄弟节点，重复该操作，当没有更多兄弟节点时，返回至父节点
function completeUnitOfWork(unitOfWork: Fiber): Fiber | null {
  // Attempt to complete the current unit of work, then move to the next
  // sibling. If there are no more siblings, return to the parent fiber.

  //从下至上，移动到该节点的兄弟节点，如果一直往上没有兄弟节点，就返回父节点
  //可想而知，最终会到达 root 节点
  workInProgress = unitOfWork;
  do {
    // The current, flushed, state of this fiber is the alternate. Ideally
    // nothing should rely on this, but relying on it here means that we don't
    // need an additional field on the work in progress.

    //获取当前节点
    const current = workInProgress.alternate;
    //获取父节点
    const returnFiber = workInProgress.return;

    // Check if the work completed or if something threw.
    //判断节点的操作是否完成，还是有异常丢出
    //Incomplete表示捕获到该节点抛出的 error

    //&是表示位的与运算，把左右两边的数字转化为二进制，然后每一位分别进行比较，如果相等就为1，不相等即为0

    //如果该节点没有异常抛出的话，即可正常执行
    if ((workInProgress.effectTag & Incomplete) === NoEffect) {
      //dev 环境，可不看
      setCurrentDebugFiberInDEV(workInProgress);

      let next;
      //如果不能使用分析器的 timer 的话，直接执行completeWork，
      //否则执行分析器timer，并执行completeWork
      if (
        !enableProfilerTimer ||
        (workInProgress.mode & ProfileMode) === NoMode
      ) {
        //完成该节点的更新
        next =  (current, workInProgress, renderExpirationTime);
      } else {
        //启动分析器的定时器，并赋成当前时间
        startProfilerTimer(workInProgress);
        //完成该节点的更新
        next = completeWork(current, workInProgress, renderExpirationTime);
        // Update render duration assuming we didn't error.
        //在没有报错的前提下，更新渲染持续时间

        //记录分析器的timer的运行时间间隔，并停止timer
        stopProfilerTimerIfRunningAndRecordDelta(workInProgress, false);
      }
      //停止 work 计时，可不看
      stopWorkTimer(workInProgress);
      //dev 环境，可不看
      resetCurrentDebugFiberInDEV();
      //更新该节点的 work 时长和子节点的 expirationTime
      resetChildExpirationTime(workInProgress);
      //如果next存在，则表示产生了新 work
      if (next !== null) {
        // Completing this fiber spawned new work. Work on that next.
        //返回 next，以便执行新 work
        return next;
      }
      //如果父节点存在，并且其 Effect 链没有被赋值的话，也就是说它没有产生副作用的话
      if (
        returnFiber !== null &&
        // Do not append effects to parents if a sibling failed to complete
        (returnFiber.effectTag & Incomplete) === NoEffect
      ) {
        // Append all the effects of the subtree and this fiber onto the effect
        // list of the parent. The completion order of the children affects the
        // side-effect order.
        //子节点的完成顺序会影响副作用的顺序

        //如果父节点没有挂载firstEffect的话，将当前节点的firstEffect赋值给父节点的firstEffect
        if (returnFiber.firstEffect === null) {
          returnFiber.firstEffect = workInProgress.firstEffect;
        }
        //同上，根据当前节点的lastEffect，初始化父节点的lastEffect
        if (workInProgress.lastEffect !== null) {
          //如果父节点的lastEffect有值的话，将nextEffect赋值
          //目的是串联Effect链
          if (returnFiber.lastEffect !== null) {
            returnFiber.lastEffect.nextEffect = workInProgress.firstEffect;
          }
          returnFiber.lastEffect = workInProgress.lastEffect;
        }

        // If this fiber had side-effects, we append it AFTER the children's
        // side-effects. We can perform certain side-effects earlier if needed,
        // by doing multiple passes over the effect list. We don't want to
        // schedule our own side-effect on our own list because if end up
        // reusing children we'll schedule this effect onto itself since we're
        // at the end.
        //获取副作用标记
        const effectTag = workInProgress.effectTag;

        // Skip both NoWork and PerformedWork tags when creating the effect
        // list. PerformedWork effect is read by React DevTools but shouldn't be
        // committed.
        //如果该副作用标记大于PerformedWork
        if (effectTag > PerformedWork) {
          //当父节点的lastEffect不为空的时候，将当前节点挂载到父节点的副作用链的最后
          if (returnFiber.lastEffect !== null) {
            returnFiber.lastEffect.nextEffect = workInProgress;
          } else {
            //否则，将当前节点挂载在父节点的副作用链的头-firstEffect上
            returnFiber.firstEffect = workInProgress;
          }
          //无论父节点的lastEffect是否为空，都将当前节点挂载在父节点的副作用链的lastEffect上
          returnFiber.lastEffect = workInProgress;
        }
      }
    }
    //如果该 fiber 节点未能完成 work 的话(报错)
    else {
      // This fiber did not complete because something threw. Pop values off
      // the stack without entering the complete phase. If this is a boundary,
      // capture values if possible.
      //节点未能完成更新，捕获其中的错误
      const next = unwindWork(workInProgress, renderExpirationTime);

      // Because this fiber did not complete, don't reset its expiration time.
      //由于该 fiber 未能完成，所以不必重置它的 expirationTime
      if (
        enableProfilerTimer &&
        (workInProgress.mode & ProfileMode) !== NoMode
      ) {
        // Record the render duration for the fiber that errored.
        //记录分析器的timer的运行时间间隔，并停止timer
        stopProfilerTimerIfRunningAndRecordDelta(workInProgress, false);

        // Include the time spent working on failed children before continuing.
        //虽然报错了，但仍然会累计 work 时长
        let actualDuration = workInProgress.actualDuration;
        let child = workInProgress.child;
        while (child !== null) {
          actualDuration += child.actualDuration;
          child = child.sibling;
        }
        workInProgress.actualDuration = actualDuration;
      }
      //如果next存在，则表示产生了新 work
      if (next !== null) {
        // If completing this work spawned new work, do that next. We'll come
        // back here again.
        // Since we're restarting, remove anything that is not a host effect
        // from the effect tag.
        // TODO: The name stopFailedWorkTimer is misleading because Suspense
        // also captures and restarts.
        //停止失败的 work 计时，可不看
        stopFailedWorkTimer(workInProgress);
        //更新其 effectTag，标记是 restart 的
        next.effectTag &= HostEffectMask;
        //返回 next，以便执行新 work
        return next;
      }
      //停止 work 计时，可不看
      stopWorkTimer(workInProgress);
      //如果父节点存在的话，重置它的 Effect 链，标记为「未完成」
      if (returnFiber !== null) {
        // Mark the parent fiber as incomplete and clear its effect list.
        returnFiber.firstEffect = returnFiber.lastEffect = null;
        returnFiber.effectTag |= Incomplete;
      }
    }
    //=======else end==============================
    //获取兄弟节点
    const siblingFiber = workInProgress.sibling;
    if (siblingFiber !== null) {
      // If there is more work to do in this returnFiber, do that next.
      return siblingFiber;
    }
    // Otherwise, return to the parent
    //如果能执行到这一步的话，说明 siblingFiber 为 null，
    //那么就返回至父节点
    workInProgress = returnFiber;
  } while (workInProgress !== null);

  // We've reached the root.
  //当执行到这里的时候，说明遍历到了 root 节点，已完成遍历
  //更新workInProgressRootExitStatus的状态为「已完成」
  if (workInProgressRootExitStatus === RootIncomplete) {
    workInProgressRootExitStatus = RootCompleted;
  }
  return null;
}

//更新该节点的 work 时长和获取优先级最高的子节点的 expirationTime
function resetChildExpirationTime(completedWork: Fiber) {
  //如果当前渲染的节点需要更新，但是子节点不需要更新的话，则 return
  if (
    renderExpirationTime !== Never &&
    completedWork.childExpirationTime === Never
  ) {
    // The children of this component are hidden. Don't bubble their
    // expiration times.
    return;
  }

  let newChildExpirationTime = NoWork;

  // Bubble up the earliest expiration time.
  if (enableProfilerTimer && (completedWork.mode & ProfileMode) !== NoMode) {
    // In profiling mode, resetChildExpirationTime is also used to reset
    // profiler durations.
    //获取当前节点的实际 work 时长
    let actualDuration = completedWork.actualDuration;
    //获取 fiber 树的 work 时长
    let treeBaseDuration = completedWork.selfBaseDuration;

    // When a fiber is cloned, its actualDuration is reset to 0. This value will
    // only be updated if work is done on the fiber (i.e. it doesn't bailout).
    // When work is done, it should bubble to the parent's actualDuration. If
    // the fiber has not been cloned though, (meaning no work was done), then
    // this value will reflect the amount of time spent working on a previous
    // render. In that case it should not bubble. We determine whether it was
    // cloned by comparing the child pointer.
    // 当一个 fiber 节点被克隆后，它的实际 work 时长被重置为 0.
    // 这个值只会在 fiber 自身上的 work 完成时被更新(顺利执行的话)
    // 当 fiber 自身 work 完成后，将自身的实际 work 时长冒泡赋给父节点的实际 work 时长
    // 如果 fiber 没有被克隆，即 work 未被完成的话，actualDuration 反映的是上次渲染的实际 work 时长
    // 如果是这种情况的话，不应该冒泡赋给父节点
    // React 通过比较 子指针 来判断 fiber 是否被克隆

    // 关于 alternate 的作用，请看：https://juejin.im/post/5d5aa4695188257573635a0d
    // 是否将 work 时间冒泡至父节点的依据是：
    // (1) 该 fiber 节点是否是第一次渲染
    // (2) 该 fiber 节点的子节点有更新
    const shouldBubbleActualDurations =
      completedWork.alternate === null ||
      completedWork.child !== completedWork.alternate.child;

    //获取当前节点的第一个子节点
    let child = completedWork.child;

    //当该子节点存在时，通过newChildExpirationTime来获取子节点、子子节点两者中优先级最高的那个expirationTime
    while (child !== null) {
      //获取该子节点的 expirationTime
      const childUpdateExpirationTime = child.expirationTime;
      //获取该子节点的 child 的 expirationTime
      const childChildExpirationTime = child.childExpirationTime;
      //如果子节点的优先级大于NoWork的话，则将newChild的 expirationTime 赋值为该子节点的 expirationTime
      if (childUpdateExpirationTime > newChildExpirationTime) {
        newChildExpirationTime = childUpdateExpirationTime;
      }
      //子节点的 child 同上
      if (childChildExpirationTime > newChildExpirationTime) {
        newChildExpirationTime = childChildExpirationTime;
      }

      if (shouldBubbleActualDurations) {
        //累计子节点的 work 时长
        actualDuration += child.actualDuration;
      }
      //累计 fiber 树的 work 时长
      treeBaseDuration += child.treeBaseDuration;
      //移动到兄弟节点，重复上述过程
      child = child.sibling;
    }
    //更新 fiber 的 work 时长
    completedWork.actualDuration = actualDuration;
    //更新 fiber 树的 work 时长
    completedWork.treeBaseDuration = treeBaseDuration;
  }
  //逻辑同上，不再赘述
  else {
    let child = completedWork.child;
    while (child !== null) {
      const childUpdateExpirationTime = child.expirationTime;
      const childChildExpirationTime = child.childExpirationTime;
      if (childUpdateExpirationTime > newChildExpirationTime) {
        newChildExpirationTime = childUpdateExpirationTime;
      }
      if (childChildExpirationTime > newChildExpirationTime) {
        newChildExpirationTime = childChildExpirationTime;
      }
      child = child.sibling;
    }
  }

  completedWork.childExpirationTime = newChildExpirationTime;
}

//以最高优先级去执行commitRootImpl()
//如果有脏作用的话，用一个 callback 回调函数去清除掉它们
function commitRoot(root) {
  //ImmediatePriority，优先级为 99，最高优先级，立即执行
  //bind函数，请看：https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Function/bind

  //获取调度优先级，并临时替换当前的优先级，去执行传进来的 callback
  runWithPriority(ImmediatePriority, commitRootImpl.bind(null, root));
  // If there are passive effects, schedule a callback to flush them. This goes
  // outside commitRootImpl so that it inherits the priority of the render.
  //如果还有脏作用的话，用一个 callback 回调函数去清除掉它们
  //因为是在commitRootImpl()外执行的，所以会继承 render 时的优先级
  if (rootWithPendingPassiveEffects !== null) {
    //获取render 时的优先级
    //请看：[React源码解析之scheduleWork（上）](https://juejin.im/post/5d7fa983f265da03cf7ac048)中的「五、getCurrentPriorityLevel()」
    const priorityLevel = getCurrentPriorityLevel();
    //对callback进行包装处理，并更新调度队列的状态

    //请看[React源码解析之scheduleWork（下）](https://juejin.im/post/5d885b75f265da03e83baaa7)中的[十、scheduleSyncCallback()]的解析
    scheduleCallback(priorityLevel, () => {
      //清除脏作用
      flushPassiveEffects();
      return null;
    });
  }
  return null;
}

//1、根据 effect 链判断是否进行 commit
//① 当执行 commit 时，进行「before mutation」、「mutation」和「layout」三个子阶段
//② 否则快速过掉 commit 阶段，走个 report 流程
//
//2、判断本次 commit 是否会产生新的更新，也就是脏作用，如果有脏作用则处理它
//
//3、检查目标 fiber 是否有剩余的 work要做
//① 如果有剩余的 work 的话，执行这些调度任务
//② 没有的话，说明也没有报错，清除「错误边界」

//4、刷新同步队列
function commitRootImpl(root) {
  //清除脏作用
  flushPassiveEffects();
  //dev 代码可不看
  //flushRenderPhaseStrictModeWarningsInDEV();
  //flushSuspensePriorityWarningInDEV();

  //===context判断====
  invariant(
    (executionContext & (RenderContext | CommitContext)) === NoContext,
    'Should not already be working.',
  );

  //调度完的任务
  const finishedWork = root.finishedWork;
  //调度完的优先级
  const expirationTime = root.finishedExpirationTime;
  //表示该节点没有要更新的任务，直接 return
  if (finishedWork === null) {
    return null;
  }
  //赋值给变量 finishedWork、expirationTime 后重置成初始值
  //因为下面在对finishedWork、expirationTime 进行 commit后，任务就完成了
  root.finishedWork = null;
  root.finishedExpirationTime = NoWork;

  //error 判断
  invariant(
    finishedWork !== root.current,
    'Cannot commit the same tree as before. This error is likely caused by ' +
      'a bug in React. Please file an issue.',
  );

  // commitRoot never returns a continuation; it always finishes synchronously.
  // So we can clear these now to allow a new callback to be scheduled.
  //commitRoot 是最后阶段，不会再被异步调用了，所以会清除 callback 相关的属性
  root.callbackNode = null;
  root.callbackExpirationTime = NoWork;

  //计时器，可跳过
  startCommitTimer();

  // Update the first and last pending times on this root. The new first
  // pending time is whatever is left on the root fiber.
  //目标节点的更新优先级
  const updateExpirationTimeBeforeCommit = finishedWork.expirationTime;
  //子节点的更新优先级，也就是所有子节点中优先级最高的任务
  //关于 childExpirationTime，请看：https://juejin.im/post/5dcdfee86fb9a01ff600fe1d
  const childExpirationTimeBeforeCommit = finishedWork.childExpirationTime;
  //获取优先级最高的 expirationTime
  const firstPendingTimeBeforeCommit =
    childExpirationTimeBeforeCommit > updateExpirationTimeBeforeCommit
      ? childExpirationTimeBeforeCommit
      : updateExpirationTimeBeforeCommit;
  //firstPendingTime即优先级最高的任务的 expirationTime
  root.firstPendingTime = firstPendingTimeBeforeCommit;
  //如果firstPendingTime<lastPendingTime的话，一般意味着所有的更新任务都已经完成了，更新lastPendingTime
  if (firstPendingTimeBeforeCommit < root.lastPendingTime) {
    // This usually means we've finished all the work, but it can also happen
    // when something gets downprioritized during render, like a hidden tree.
    root.lastPendingTime = firstPendingTimeBeforeCommit;
  }
  //如果目标节点root就是正在更新的节点 workInProgressRoot 的话
  //将相关值置为初始值，因为接下来会完成它的更新操作
  if (root === workInProgressRoot) {
    // We can reset these now that they are finished.
    workInProgressRoot = null;
    workInProgress = null;
    renderExpirationTime = NoWork;
  } else {
    // This indicates that the last root we worked on is not the same one that
    // we're committing now. This most commonly happens when a suspended root
    // times out.
  }

  // Get the list of effects.
  //获取 effect 链
  let firstEffect;
  //如果RootFiber 的 effectTag 有值的话，也就是说RootFiber也要commit的话
  //将它的 finishedWork 也插入到 effect 链上，放到effect 链的最后 lastEffect.nextEffect 上
  if (finishedWork.effectTag > PerformedWork) {
    // A fiber's effect list consists only of its children, not itself. So if
    // the root has an effect, we need to add it to the end of the list. The
    // resulting list is the set that would belong to the root's parent, if it
    // had one; that is, all the effects in the tree including the root.
    if (finishedWork.lastEffect !== null) {
      finishedWork.lastEffect.nextEffect = finishedWork;
      firstEffect = finishedWork.firstEffect;
    } else {
      firstEffect = finishedWork;
    }
  } else {
    // There is no effect on the root.
    firstEffect = finishedWork.firstEffect;
  }

  //effect 链上第一个需要更新的 fiber 对象
  if (firstEffect !== null) {
    //=======context 相关，暂时跳过=========
    // const prevExecutionContext = executionContext;
    // executionContext |= CommitContext;
    // let prevInteractions: Set<Interaction> | null = null;
    // if (enableSchedulerTracing) {
    //   prevInteractions = __interactionsRef.current;
    //   __interactionsRef.current = root.memoizedInteractions;
    // }

    // Reset this to null before calling lifecycles
    ReactCurrentOwner.current = null;

    // The commit phase is broken into several sub-phases. We do a separate pass
    // of the effect list for each phase: all mutation effects come before all
    // layout effects, and so on.
    // 提交阶段分为几个子阶段。我们对每个阶段的效果列表进行单独的遍历:所有的mutation(突变)效果都在所有的layout效果之前

    // The first phase a "before mutation" phase. We use this phase to read the
    // state of the host tree right before we mutate it. This is where
    // getSnapshotBeforeUpdate is called.
    //第一个子阶段是「在mutation突变之前」阶段，在这个阶段 React 会读取 fiber 树的 state 状态，
    //也是用 getSnapshotBeforeUpdate 命名的原因

    //标记开始进行「before mutation」子阶段了
    startCommitSnapshotEffectsTimer();
    //更新当前选中的DOM节点，一般为 document.activeElement || document.body
    prepareForCommit(root.containerInfo);
    nextEffect = firstEffect;
    //===========第一个 while 循环==============
    do {
      if (__DEV__) {
        invokeGuardedCallback(null, commitBeforeMutationEffects, null);
        //删除了 dev 代码
      } else {
        try {
          //调用 classComponent 上的生命周期方法 getSnapshotBeforeUpdate
          //关于getSnapshotBeforeUpdate，请看：https://zh-hans.reactjs.org/docs/react-component.html#getsnapshotbeforeupdate
          commitBeforeMutationEffects();
        } catch (error) {
          invariant(nextEffect !== null, 'Should be working on an effect.');
          captureCommitPhaseError(nextEffect, error);
          nextEffect = nextEffect.nextEffect;
        }
      }
    } while (nextEffect !== null);
    //标记「before mutation」子阶段已经结束
    stopCommitSnapshotEffectsTimer();

    //======profiler相关，暂时跳过======
    if (enableProfilerTimer) {
      // Mark the current commit time to be shared by all Profilers in this
      // batch. This enables them to be grouped later.
      recordCommitTime();
    }

    // The next phase is the mutation phase, where we mutate the host tree.
    //标记开始进行「mutation」子阶段了
    startCommitHostEffectsTimer();
    nextEffect = firstEffect;
    //=============第二个 while 循环=================
    do {
      if (__DEV__) {
        invokeGuardedCallback(null, commitMutationEffects, null);
        //删除了 dev 代码
      } else {
        try {
          //提交HostComponent的 side effect，也就是 DOM 节点的操作(增删改)
          commitMutationEffects();
        } catch (error) {
          invariant(nextEffect !== null, 'Should be working on an effect.');
          captureCommitPhaseError(nextEffect, error);
          nextEffect = nextEffect.nextEffect;
        }
      }
    } while (nextEffect !== null);
    //标记「mutation」子阶段已经结束
    stopCommitHostEffectsTimer();
    //当进行 DOM 操作时，比如删除，可能会丢失选中 DOM 的焦点，此方法能保存丢失的值
    resetAfterCommit(root.containerInfo);

    // The work-in-progress tree is now the current tree. This must come after
    // the mutation phase, so that the previous tree is still current during
    // componentWillUnmount, but before the layout phase, so that the finished
    // work is current during componentDidMount/Update.

    //在「mutation」子阶段后，正在进行的fiber树(work-in-progress tree)就成了 current tree
    //以便在 componentWillUnmount 期间，保证 先前的 fiber 树是 current tree
    //以便在「layout」子阶段之前，保证 work-in-progress 的 finishedWork 是 current

    //没看懂注释，大概意思应该是随着不同子阶段的进行，及时更新 root.current，也就是当前的 fiber 树更新成正在执行 commit 的 fiber 树
    root.current = finishedWork;

    // The next phase is the layout phase, where we call effects that read
    // the host tree after it's been mutated. The idiomatic use case for this is
    // layout, but class component lifecycles also fire here for legacy reasons.
    //标记开始进行「layout」子阶段了
    //这个阶段会触发所有组件的生命周期(lifecycles)的提交
    startCommitLifeCyclesTimer();
    nextEffect = firstEffect;
    //=============第三个 while 循环==========================
    do {
      if (__DEV__) {
        invokeGuardedCallback(
          null,
          commitLayoutEffects,
          null,
          root,
          expirationTime,
        );
        //删除了 dev 代码
      } else {
        try {
          //commit lifecycles,也就是触发生命周期的 api

          //① 循环 effect 链，针对不同的 fiber 类型，进行effect.destroy()/componentDidMount()/callback/node.focus()等操作
          //② 指定 ref 的引用
          commitLayoutEffects(root, expirationTime);
        } catch (error) {
          invariant(nextEffect !== null, 'Should be working on an effect.');
          captureCommitPhaseError(nextEffect, error);
          nextEffect = nextEffect.nextEffect;
        }
      }
    } while (nextEffect !== null);
    //标记「layout」子阶段已经结束
    stopCommitLifeCyclesTimer();
    //正在 commit 的 effect 置为 null，表示 commit 结束
    nextEffect = null;

    // Tell Scheduler to yield at the end of the frame, so the browser has an
    // opportunity to paint.
    //React 占用的资源已结束，告知浏览器可以去绘制 ui 了
    requestPaint();

    //=======暂时跳过=============
    if (enableSchedulerTracing) {
      __interactionsRef.current = ((prevInteractions: any): Set<Interaction>);
    }
    executionContext = prevExecutionContext;
  }
  //如果 effect 链没有需要更新的 fiber 对象
  else {
    // No effects.
    root.current = finishedWork;
    // Measure these anyway so the flamegraph explicitly shows that there were
    // no effects.
    // TODO: Maybe there's a better way to report this.

    //快速过掉 commit 阶段，走个 report 流程
    startCommitSnapshotEffectsTimer();
    stopCommitSnapshotEffectsTimer();
    if (enableProfilerTimer) {
      recordCommitTime();
    }
    startCommitHostEffectsTimer();
    stopCommitHostEffectsTimer();
    startCommitLifeCyclesTimer();
    stopCommitLifeCyclesTimer();
  }
  //标记 commit 阶段结束
  stopCommitTimer();
  //判断本次 commit 是否会产生新的更新，也就是脏作用
  const rootDidHavePassiveEffects = rootDoesHavePassiveEffects;
  //如果有脏作用的处理
  if (rootDoesHavePassiveEffects) {
    // This commit has passive effects. Stash a reference to them. But don't
    // schedule a callback until after flushing layout work.
    rootDoesHavePassiveEffects = false;
    rootWithPendingPassiveEffects = root;
    pendingPassiveEffectsExpirationTime = expirationTime;
  }

  // Check if there's remaining work on this root
  //检查是否有剩余的 work
  const remainingExpirationTime = root.firstPendingTime;
  //如果有剩余的 work 的话
  if (remainingExpirationTime !== NoWork) {
    //计算当前时间
    const currentTime = requestCurrentTime();
    //通过 expirationTime 推断优先级
    const priorityLevel = inferPriorityFromExpirationTime(
      currentTime,
      remainingExpirationTime,
    );

    if (enableSchedulerTracing) {
      //render 阶段衍生的 work，可能指新的 update 或者新的 error
      if (spawnedWorkDuringRender !== null) {
        const expirationTimes = spawnedWorkDuringRender;
        spawnedWorkDuringRender = null;
        //循环执行 scheduleInteractions
        for (let i = 0; i < expirationTimes.length; i++) {
          //与schedule的交互
          //请看：[React源码解析之scheduleWork（上）](https://juejin.im/post/5d7fa983f265da03cf7ac048)中的「六、schedulePendingInteractions()」
          scheduleInteractions(
            root,
            expirationTimes[i],
            root.memoizedInteractions,
          );
        }
      }
    }
    // 同步调用callback
    // 流程是在root上存取callback和expirationTime，
    // 当新的callback调用时，比较更新expirationTime

    //请看：[React源码解析之scheduleWork（下）](https://juejin.im/post/5d885b75f265da03e83baaa7)中的「八、scheduleCallbackForRoot()」
    scheduleCallbackForRoot(root, priorityLevel, remainingExpirationTime);
  }
  //如果没有剩余的 work 的话，说明 commit 成功，那么就清除「错误边界」的 list
  else {
    // If there's no remaining work, we can clear the set of already failed
    // error boundaries.
    legacyErrorBoundariesThatAlreadyFailed = null;
  }

  if (enableSchedulerTracing) {
    //当本次 commit 产生的脏作用被清除后，React就可以清除已经完成的交互
    if (!rootDidHavePassiveEffects) {
      // If there are no passive effects, then we can complete the pending interactions.
      // Otherwise, we'll wait until after the passive effects are flushed.
      // Wait to do this until after remaining work has been scheduled,
      // so that we don't prematurely signal complete for interactions when there's e.g. hidden work.

      //清除已经完成的交互，如果被 suspended 挂起的话，把交互留到后续呈现
      finishPendingInteractions(root, expirationTime);
    }
  }
  //devTools 相关的，可不看
  onCommitRoot(finishedWork.stateNode, expirationTime);

  //剩余的 work 是同步任务的话
  if (remainingExpirationTime === Sync) {
    // Count the number of times the root synchronously re-renders without
    // finishing. If there are too many, it indicates an infinite update loop.

    //计算同步 re-render 重新渲染的次数，判断是否是无限循环
    if (root === rootWithNestedUpdates) {
      nestedUpdateCount++;
    } else {
      nestedUpdateCount = 0;
      rootWithNestedUpdates = root;
    }
  } else {
    nestedUpdateCount = 0;
  }
  //如果捕获到错误的话，就 throw error
  if (hasUncaughtError) {
    hasUncaughtError = false;
    const error = firstUncaughtError;
    firstUncaughtError = null;
    throw error;
  }

  //可不看
  if ((executionContext & LegacyUnbatchedContext) !== NoContext) {
    // This is a legacy edge case. We just committed the initial mount of
    // a ReactDOM.render-ed root inside of batchedUpdates. The commit fired
    // synchronously, but layout updates should be deferred until the end
    // of the batch.
    return null;
  }

  // If layout work was scheduled, flush it now.
  //「layout」阶段的任务已经被调度的话,立即清除它

  //刷新同步任务队列
  //请看：[React源码解析之scheduleWork（下）](https://juejin.im/post/5d885b75f265da03e83baaa7)中的「十二、flushSyncCallbackQueue()」
  flushSyncCallbackQueue();
  return null;
}
//===========================================================
//循环 effect 链，对有 Snapshot 的 effect 执行 commitBeforeMutationEffectOnFiber
function commitBeforeMutationEffects() {
  //循环 effect 链
  while (nextEffect !== null) {
    //如果 effectTag 里有 Snapshot 这个 effectTag 的话
    //关于&，请看[前端小知识10点(2020.2.10)](https://mp.weixin.qq.com/s/tt2XcW4GF7oBBZOPwTiCcg)中的「8、JS 中的 & 是什么意思」
    if ((nextEffect.effectTag & Snapshot) !== NoEffect) {
      //dev 可不看
      // setCurrentDebugFiberInDEV(nextEffect);
      //计 effect 的数
      recordEffect();
      //获取当前 fiber 节点
      const current = nextEffect.alternate;
      commitBeforeMutationEffectOnFiber(current, nextEffect);
      //dev 可不看
      // resetCurrentDebugFiberInDEV();
    }
    nextEffect = nextEffect.nextEffect;
  }
}

//提交HostComponent的 side effect，也就是 DOM 节点的操作(增删改)
function commitMutationEffects() {
  // TODO: Should probably move the bulk of this function to commitWork.
  //循环 effect 链
  while (nextEffect !== null) {
    setCurrentDebugFiberInDEV(nextEffect);

    const effectTag = nextEffect.effectTag;
    //如果有文字节点，则将value 置为''
    if (effectTag & ContentReset) {
      commitResetTextContent(nextEffect);
    }
    ////将 ref 的指向置为 null
    if (effectTag & Ref) {
      const current = nextEffect.alternate;
      if (current !== null) {
        commitDetachRef(current);
      }
    }

    // The following switch statement is only concerned about placement,
    // updates, and deletions. To avoid needing to add a case for every possible
    // bitmap value, we remove the secondary effects from the effect tag and
    // switch on that value.
    //以下情况是针对 替换(Placement)、更新(Update)和 删除(Deletion) 的 effectTag 的
    let primaryEffectTag = effectTag & (Placement | Update | Deletion);
    switch (primaryEffectTag) {
      //插入新节点
      case Placement: {
        //针对该节点及子节点进行插入操作
        commitPlacement(nextEffect);
        // Clear the "placement" from effect tag so that we know that this is
        // inserted, before any life-cycles like componentDidMount gets called.
        // TODO: findDOMNode doesn't rely on this any more but isMounted does
        // and isMounted is deprecated anyway so we should be able to kill this.
        nextEffect.effectTag &= ~Placement;
        break;
      }
      //替换并更新该节点是Placement和Update的结合，就不讲了
      case PlacementAndUpdate: {
        // Placement
        //针对该节点及子节点进行插入操作
        commitPlacement(nextEffect);
        // Clear the "placement" from effect tag so that we know that this is
        // inserted, before any life-cycles like componentDidMount gets called.
        nextEffect.effectTag &= ~Placement;

        // Update
        const current = nextEffect.alternate;
        //对 DOM 节点上的属性进行更新
        commitWork(current, nextEffect);
        break;
      }
      //更新节点
      //旧节点->新节点
      case Update: {
        const current = nextEffect.alternate;
        //对 DOM 节点上的属性进行更新
        commitWork(current, nextEffect);
        break;
      }
      case Deletion: {
        //删除节点
        commitDeletion(nextEffect);
        break;
      }
    }

    // TODO: Only record a mutation effect if primaryEffectTag is non-zero.
    //不看
    recordEffect();
    //dev，不看
    resetCurrentDebugFiberInDEV();
    nextEffect = nextEffect.nextEffect;
  }
}
//① 循环 effect 链，针对不同的 fiber 类型，进行effect.destroy()/componentDidMount()/callback/node.focus()等操作
//② 指定 ref 的引用
function commitLayoutEffects(
  root: FiberRoot,
  committedExpirationTime: ExpirationTime,
) {
  // TODO: Should probably move the bulk of this function to commitWork.
  //循环 effect 链
  while (nextEffect !== null) {
    //dev 环境代码，不看
    setCurrentDebugFiberInDEV(nextEffect);

    const effectTag = nextEffect.effectTag;
    //如果有 Update、Callback 的 effectTag 的话
    if (effectTag & (Update | Callback)) {
      recordEffect();
      const current = nextEffect.alternate;
      //重点看 FunctionComponent/ClassComponent/HostComponent
      //① FunctionComponent——执行effect.destroy()
      //② ClassComponent——componentDidMount()/componentDidUpdate()，effect 链——执行 setState 的 callback，capturedEffect 链执行 componentDidCatch
      //③ HostComponent——判断是否是自动聚焦的 DOM 标签，是的话则调用 node.focus() 获取焦点
      commitLayoutEffectOnFiber(
        root,
        current,
        nextEffect,
        committedExpirationTime,
      );
    }
    //指定 ref 的引用
    if (effectTag & Ref) {
      recordEffect();
      //获取 instance 实例，并指定给 ref
      commitAttachRef(nextEffect);
    }
    //副作用
    if (effectTag & Passive) {
      rootDoesHavePassiveEffects = true;
    }
    //dev 环境，不看
    resetCurrentDebugFiberInDEV();
    nextEffect = nextEffect.nextEffect;
  }
}
//清除脏作用
export function flushPassiveEffects() {
  if (rootWithPendingPassiveEffects === null) {
    return false;
  }
  const root = rootWithPendingPassiveEffects;
  const expirationTime = pendingPassiveEffectsExpirationTime;
  rootWithPendingPassiveEffects = null;
  pendingPassiveEffectsExpirationTime = NoWork;

  let prevInteractions: Set<Interaction> | null = null;
  if (enableSchedulerTracing) {
    prevInteractions = __interactionsRef.current;
    __interactionsRef.current = root.memoizedInteractions;
  }

  invariant(
    (executionContext & (RenderContext | CommitContext)) === NoContext,
    'Cannot flush passive effects while already rendering.',
  );
  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;

  // Note: This currently assumes there are no passive effects on the root
  // fiber, because the root is not part of its own effect list. This could
  // change in the future.
  //effect 链表上第一个有副作用的 fiber
  //比如在 app() 中调用了 useEffect()
  let effect = root.current.firstEffect;
  while (effect !== null) {
    if (__DEV__) {
      //删除了 dev 代码
    } else {
      try {
        //执行 fiber 上的副作用
        commitPassiveHookEffects(effect);
      } catch (error) {
        invariant(effect !== null, 'Should be working on an effect.');
        captureCommitPhaseError(effect, error);
      }
    }
    effect = effect.nextEffect;
  }

  if (enableSchedulerTracing) {
    __interactionsRef.current = ((prevInteractions: any): Set<Interaction>);
    finishPendingInteractions(root, expirationTime);
  }

  executionContext = prevExecutionContext;
  flushSyncCallbackQueue();

  // If additional passive effects were scheduled, increment a counter. If this
  // exceeds the limit, we'll fire a warning.
  nestedPassiveUpdateCount =
    rootWithPendingPassiveEffects === null ? 0 : nestedPassiveUpdateCount + 1;

  return true;
}

export function isAlreadyFailedLegacyErrorBoundary(instance: mixed): boolean {
  return (
    legacyErrorBoundariesThatAlreadyFailed !== null &&
    legacyErrorBoundariesThatAlreadyFailed.has(instance)
  );
}

export function markLegacyErrorBoundaryAsFailed(instance: mixed) {
  if (legacyErrorBoundariesThatAlreadyFailed === null) {
    legacyErrorBoundariesThatAlreadyFailed = new Set([instance]);
  } else {
    legacyErrorBoundariesThatAlreadyFailed.add(instance);
  }
}

function prepareToThrowUncaughtError(error: mixed) {
  if (!hasUncaughtError) {
    hasUncaughtError = true;
    firstUncaughtError = error;
  }
}
export const onUncaughtError = prepareToThrowUncaughtError;

function captureCommitPhaseErrorOnRoot(
  rootFiber: Fiber,
  sourceFiber: Fiber,
  error: mixed,
) {
  const errorInfo = createCapturedValue(error, sourceFiber);
  const update = createRootErrorUpdate(rootFiber, errorInfo, Sync);
  enqueueUpdate(rootFiber, update);
  const root = markUpdateTimeFromFiberToRoot(rootFiber, Sync);
  if (root !== null) {
    scheduleCallbackForRoot(root, ImmediatePriority, Sync);
  }
}

export function captureCommitPhaseError(sourceFiber: Fiber, error: mixed) {
  if (sourceFiber.tag === HostRoot) {
    // Error was thrown at the root. There is no parent, so the root
    // itself should capture it.
    captureCommitPhaseErrorOnRoot(sourceFiber, sourceFiber, error);
    return;
  }

  let fiber = sourceFiber.return;
  while (fiber !== null) {
    if (fiber.tag === HostRoot) {
      captureCommitPhaseErrorOnRoot(fiber, sourceFiber, error);
      return;
    } else if (fiber.tag === ClassComponent) {
      const ctor = fiber.type;
      const instance = fiber.stateNode;
      if (
        typeof ctor.getDerivedStateFromError === 'function' ||
        (typeof instance.componentDidCatch === 'function' &&
          !isAlreadyFailedLegacyErrorBoundary(instance))
      ) {
        const errorInfo = createCapturedValue(error, sourceFiber);
        const update = createClassErrorUpdate(
          fiber,
          errorInfo,
          // TODO: This is always sync
          Sync,
        );
        enqueueUpdate(fiber, update);
        const root = markUpdateTimeFromFiberToRoot(fiber, Sync);
        if (root !== null) {
          scheduleCallbackForRoot(root, ImmediatePriority, Sync);
        }
        return;
      }
    }
    fiber = fiber.return;
  }
}

export function pingSuspendedRoot(
  root: FiberRoot,
  thenable: Thenable,
  suspendedTime: ExpirationTime,
) {
  const pingCache = root.pingCache;
  if (pingCache !== null) {
    // The thenable resolved, so we no longer need to memoize, because it will
    // never be thrown again.
    pingCache.delete(thenable);
  }

  if (workInProgressRoot === root && renderExpirationTime === suspendedTime) {
    // Received a ping at the same priority level at which we're currently
    // rendering. We might want to restart this render. This should mirror
    // the logic of whether or not a root suspends once it completes.

    // TODO: If we're rendering sync either due to Sync, Batched or expired,
    // we should probably never restart.

    // If we're suspended with delay, we'll always suspend so we can always
    // restart. If we're suspended without any updates, it might be a retry.
    // If it's early in the retry we can restart. We can't know for sure
    // whether we'll eventually process an update during this render pass,
    // but it's somewhat unlikely that we get to a ping before that, since
    // getting to the root most update is usually very fast.
    if (
      workInProgressRootExitStatus === RootSuspendedWithDelay ||
      (workInProgressRootExitStatus === RootSuspended &&
        workInProgressRootLatestProcessedExpirationTime === Sync &&
        now() - globalMostRecentFallbackTime < FALLBACK_THROTTLE_MS)
    ) {
      // Restart from the root. Don't need to schedule a ping because
      // we're already working on this tree.
      prepareFreshStack(root, renderExpirationTime);
    } else {
      // Even though we can't restart right now, we might get an
      // opportunity later. So we mark this render as having a ping.
      workInProgressRootHasPendingPing = true;
    }
    return;
  }

  const lastPendingTime = root.lastPendingTime;
  if (lastPendingTime < suspendedTime) {
    // The root is no longer suspended at this time.
    return;
  }

  const pingTime = root.pingTime;
  if (pingTime !== NoWork && pingTime < suspendedTime) {
    // There's already a lower priority ping scheduled.
    return;
  }

  // Mark the time at which this ping was scheduled.
  root.pingTime = suspendedTime;

  if (root.finishedExpirationTime === suspendedTime) {
    // If there's a pending fallback waiting to commit, throw it away.
    root.finishedExpirationTime = NoWork;
    root.finishedWork = null;
  }

  const currentTime = requestCurrentTime();
  const priorityLevel = inferPriorityFromExpirationTime(
    currentTime,
    suspendedTime,
  );
  scheduleCallbackForRoot(root, priorityLevel, suspendedTime);
}

export function retryTimedOutBoundary(boundaryFiber: Fiber) {
  // The boundary fiber (a Suspense component or SuspenseList component)
  // previously was rendered in its fallback state. One of the promises that
  // suspended it has resolved, which means at least part of the tree was
  // likely unblocked. Try rendering again, at a new expiration time.
  const currentTime = requestCurrentTime();
  const suspenseConfig = null; // Retries don't carry over the already committed update.
  const retryTime = computeExpirationForFiber(
    currentTime,
    boundaryFiber,
    suspenseConfig,
  );
  // TODO: Special case idle priority?
  const priorityLevel = inferPriorityFromExpirationTime(currentTime, retryTime);
  const root = markUpdateTimeFromFiberToRoot(boundaryFiber, retryTime);
  if (root !== null) {
    scheduleCallbackForRoot(root, priorityLevel, retryTime);
  }
}

export function resolveRetryThenable(boundaryFiber: Fiber, thenable: Thenable) {
  let retryCache: WeakSet<Thenable> | Set<Thenable> | null;
  if (enableSuspenseServerRenderer) {
    switch (boundaryFiber.tag) {
      case SuspenseComponent:
        retryCache = boundaryFiber.stateNode;
        break;
      case DehydratedSuspenseComponent:
        retryCache = boundaryFiber.memoizedState;
        break;
      default:
        invariant(
          false,
          'Pinged unknown suspense boundary type. ' +
            'This is probably a bug in React.',
        );
    }
  } else {
    retryCache = boundaryFiber.stateNode;
  }

  if (retryCache !== null) {
    // The thenable resolved, so we no longer need to memoize, because it will
    // never be thrown again.
    retryCache.delete(thenable);
  }

  retryTimedOutBoundary(boundaryFiber);
}

// Computes the next Just Noticeable Difference (JND) boundary.
// The theory is that a person can't tell the difference between small differences in time.
// Therefore, if we wait a bit longer than necessary that won't translate to a noticeable
// difference in the experience. However, waiting for longer might mean that we can avoid
// showing an intermediate loading state. The longer we have already waited, the harder it
// is to tell small differences in time. Therefore, the longer we've already waited,
// the longer we can wait additionally. At some point we have to give up though.
// We pick a train model where the next boundary commits at a consistent schedule.
// These particular numbers are vague estimates. We expect to adjust them based on research.
function jnd(timeElapsed: number) {
  return timeElapsed < 120
    ? 120
    : timeElapsed < 480
      ? 480
      : timeElapsed < 1080
        ? 1080
        : timeElapsed < 1920
          ? 1920
          : timeElapsed < 3000
            ? 3000
            : timeElapsed < 4320
              ? 4320
              : ceil(timeElapsed / 1960) * 1960;
}

function computeMsUntilSuspenseLoadingDelay(
  mostRecentEventTime: ExpirationTime,
  committedExpirationTime: ExpirationTime,
  suspenseConfig: SuspenseConfig,
) {
  const busyMinDurationMs = (suspenseConfig.busyMinDurationMs: any) | 0;
  if (busyMinDurationMs <= 0) {
    return 0;
  }
  const busyDelayMs = (suspenseConfig.busyDelayMs: any) | 0;

  // Compute the time until this render pass would expire.
  const currentTimeMs: number = now();
  const eventTimeMs: number = inferTimeFromExpirationTimeWithSuspenseConfig(
    mostRecentEventTime,
    suspenseConfig,
  );
  const timeElapsed = currentTimeMs - eventTimeMs;
  if (timeElapsed <= busyDelayMs) {
    // If we haven't yet waited longer than the initial delay, we don't
    // have to wait any additional time.
    return 0;
  }
  const msUntilTimeout = busyDelayMs + busyMinDurationMs - timeElapsed;
  // This is the value that is passed to `setTimeout`.
  return msUntilTimeout;
}

//防止无限循环地嵌套更新
function checkForNestedUpdates() {
  if (nestedUpdateCount > NESTED_UPDATE_LIMIT) {
    nestedUpdateCount = 0;
    rootWithNestedUpdates = null;
    invariant(
      false,
      'Maximum update depth exceeded. This can happen when a component ' +
        'repeatedly calls setState inside componentWillUpdate or ' +
        'componentDidUpdate. React limits the number of nested updates to ' +
        'prevent infinite loops.',
    );
  }


}

function flushRenderPhaseStrictModeWarningsInDEV() {
  if (__DEV__) {
    ReactStrictModeWarnings.flushPendingUnsafeLifecycleWarnings();
    ReactStrictModeWarnings.flushLegacyContextWarning();

    if (warnAboutDeprecatedLifecycles) {
      ReactStrictModeWarnings.flushPendingDeprecationWarnings();
    }
  }
}

function stopFinishedWorkLoopTimer() {
  const didCompleteRoot = true;
  stopWorkLoopTimer(interruptedBy, didCompleteRoot);
  interruptedBy = null;
}
//停止计时
function stopInterruptedWorkLoopTimer() {
  // TODO: Track which fiber caused the interruption.
  /*_didCompleteRoot <=> didCompleteRoot*/
  const didCompleteRoot = false;
  stopWorkLoopTimer(interruptedBy, didCompleteRoot);
  interruptedBy = null;
}
//判断是否有高优先级任务打断当前正在执行的任务
function checkForInterruption(
  fiberThatReceivedUpdate: Fiber,
  updateExpirationTime: ExpirationTime,
) {
  //如果任务正在执行，并且异步任务已经执行到一半了，
  //但是现在需要把执行权交给浏览器，去执行优先级更高的任务
  if (
    enableUserTimingAPI &&
    workInProgressRoot !== null &&
    updateExpirationTime > renderExpirationTime
  ) {
    //打断当前任务，优先执行新的update
    interruptedBy = fiberThatReceivedUpdate;
  }
}

let didWarnStateUpdateForUnmountedComponent: Set<string> | null = null;
function warnAboutUpdateOnUnmountedFiberInDEV(fiber) {
  if (__DEV__) {
    const tag = fiber.tag;
    if (
      tag !== HostRoot &&
      tag !== ClassComponent &&
      tag !== FunctionComponent &&
      tag !== ForwardRef &&
      tag !== MemoComponent &&
      tag !== SimpleMemoComponent
    ) {
      // Only warn for user-defined components, not internal ones like Suspense.
      return;
    }
    // We show the whole stack but dedupe on the top component's name because
    // the problematic code almost always lies inside that component.
    const componentName = getComponentName(fiber.type) || 'ReactComponent';
    if (didWarnStateUpdateForUnmountedComponent !== null) {
      if (didWarnStateUpdateForUnmountedComponent.has(componentName)) {
        return;
      }
      didWarnStateUpdateForUnmountedComponent.add(componentName);
    } else {
      didWarnStateUpdateForUnmountedComponent = new Set([componentName]);
    }
    warningWithoutStack(
      false,
      "Can't perform a React state update on an unmounted component. This " +
        'is a no-op, but it indicates a memory leak in your application. To ' +
        'fix, cancel all subscriptions and asynchronous tasks in %s.%s',
      tag === ClassComponent
        ? 'the componentWillUnmount method'
        : 'a useEffect cleanup function',
      getStackByFiberInDevAndProd(fiber),
    );
  }
}

let beginWork;
if (__DEV__ && replayFailedUnitOfWorkWithInvokeGuardedCallback) {
  let dummyFiber = null;
  beginWork = (current, unitOfWork, expirationTime) => {
    // If a component throws an error, we replay it again in a synchronously
    // dispatched event, so that the debugger will treat it as an uncaught
    // error See ReactErrorUtils for more information.

    // Before entering the begin phase, copy the work-in-progress onto a dummy
    // fiber. If beginWork throws, we'll use this to reset the state.
    const originalWorkInProgressCopy = assignFiberPropertiesInDEV(
      dummyFiber,
      unitOfWork,
    );
    try {
      return originalBeginWork(current, unitOfWork, expirationTime);
    } catch (originalError) {
      if (
        originalError !== null &&
        typeof originalError === 'object' &&
        typeof originalError.then === 'function'
      ) {
        // Don't replay promises. Treat everything else like an error.
        throw originalError;
      }

      // Keep this code in sync with renderRoot; any changes here must have
      // corresponding changes there.
      resetContextDependencies();
      resetHooks();

      // Unwind the failed stack frame
      unwindInterruptedWork(unitOfWork);

      // Restore the original properties of the fiber.
      assignFiberPropertiesInDEV(unitOfWork, originalWorkInProgressCopy);

      if (enableProfilerTimer && unitOfWork.mode & ProfileMode) {
        // Reset the profiler timer.
        startProfilerTimer(unitOfWork);
      }

      // Run beginWork again.
      invokeGuardedCallback(
        null,
        originalBeginWork,
        null,
        current,
        unitOfWork,
        expirationTime,
      );

      if (hasCaughtError()) {
        const replayError = clearCaughtError();
        // `invokeGuardedCallback` sometimes sets an expando `_suppressLogging`.
        // Rethrow this error instead of the original one.
        throw replayError;
      } else {
        // This branch is reachable if the render phase is impure.
        throw originalError;
      }
    }
  };
} else {
  beginWork = originalBeginWork;
}

let didWarnAboutUpdateInRender = false;
let didWarnAboutUpdateInGetChildContext = false;
function warnAboutInvalidUpdatesOnClassComponentsInDEV(fiber) {
  if (__DEV__) {
    if (fiber.tag === ClassComponent) {
      switch (ReactCurrentDebugFiberPhaseInDEV) {
        case 'getChildContext':
          if (didWarnAboutUpdateInGetChildContext) {
            return;
          }
          warningWithoutStack(
            false,
            'setState(...): Cannot call setState() inside getChildContext()',
          );
          didWarnAboutUpdateInGetChildContext = true;
          break;
        case 'render':
          if (didWarnAboutUpdateInRender) {
            return;
          }
          warningWithoutStack(
            false,
            'Cannot update during an existing state transition (such as ' +
              'within `render`). Render methods should be a pure function of ' +
              'props and state.',
          );
          didWarnAboutUpdateInRender = true;
          break;
      }
    }
  }
}

export const IsThisRendererActing = {current: (false: boolean)};

export function warnIfNotScopedWithMatchingAct(fiber: Fiber): void {
  if (__DEV__) {
    if (
      warnsIfNotActing === true &&
      IsSomeRendererActing.current === true &&
      IsThisRendererActing.current !== true
    ) {
      warningWithoutStack(
        false,
        "It looks like you're using the wrong act() around your test interactions.\n" +
          'Be sure to use the matching version of act() corresponding to your renderer:\n\n' +
          '// for react-dom:\n' +
          "import {act} from 'react-dom/test-utils';\n" +
          '//...\n' +
          'act(() => ...);\n\n' +
          '// for react-test-renderer:\n' +
          "import TestRenderer from 'react-test-renderer';\n" +
          'const {act} = TestRenderer;\n' +
          '//...\n' +
          'act(() => ...);' +
          '%s',
        getStackByFiberInDevAndProd(fiber),
      );
    }
  }
}

export function warnIfNotCurrentlyActingEffectsInDEV(fiber: Fiber): void {
  if (__DEV__) {
    if (
      warnsIfNotActing === true &&
      (fiber.mode & StrictMode) !== NoMode &&
      IsSomeRendererActing.current === false &&
      IsThisRendererActing.current === false
    ) {
      warningWithoutStack(
        false,
        'An update to %s ran an effect, but was not wrapped in act(...).\n\n' +
          'When testing, code that causes React state updates should be ' +
          'wrapped into act(...):\n\n' +
          'act(() => {\n' +
          '  /* fire events that update state */\n' +
          '});\n' +
          '/* assert on the output */\n\n' +
          "This ensures that you're testing the behavior the user would see " +
          'in the browser.' +
          ' Learn more at https://fb.me/react-wrap-tests-with-act' +
          '%s',
        getComponentName(fiber.type),
        getStackByFiberInDevAndProd(fiber),
      );
    }
  }
}

function warnIfNotCurrentlyActingUpdatesInDEV(fiber: Fiber): void {
  if (__DEV__) {
    if (
      warnsIfNotActing === true &&
      executionContext === NoContext &&
      IsSomeRendererActing.current === false &&
      IsThisRendererActing.current === false
    ) {
      warningWithoutStack(
        false,
        'An update to %s inside a test was not wrapped in act(...).\n\n' +
          'When testing, code that causes React state updates should be ' +
          'wrapped into act(...):\n\n' +
          'act(() => {\n' +
          '  /* fire events that update state */\n' +
          '});\n' +
          '/* assert on the output */\n\n' +
          "This ensures that you're testing the behavior the user would see " +
          'in the browser.' +
          ' Learn more at https://fb.me/react-wrap-tests-with-act' +
          '%s',
        getComponentName(fiber.type),
        getStackByFiberInDevAndProd(fiber),
      );
    }
  }
}

export const warnIfNotCurrentlyActingUpdatesInDev = warnIfNotCurrentlyActingUpdatesInDEV;

let componentsWithSuspendedDiscreteUpdates = null;
export function checkForWrongSuspensePriorityInDEV(sourceFiber: Fiber) {
  if (__DEV__) {
    if (
      (sourceFiber.mode & ConcurrentMode) !== NoEffect &&
      // Check if we're currently rendering a discrete update. Ideally, all we
      // would need to do is check the current priority level. But we currently
      // have no rigorous way to distinguish work that was scheduled at user-
      // blocking priority from work that expired a bit and was "upgraded" to
      // a higher priority. That's because we don't schedule separate callbacks
      // for every level, only the highest priority level per root. The priority
      // of subsequent levels is inferred from the expiration time, but this is
      // an imprecise heuristic.
      //
      // However, we do store the last discrete pending update per root. So we
      // can reliably compare to that one. (If we broaden this warning to include
      // high pri updates that aren't discrete, then this won't be sufficient.)
      //
      // My rationale is that it's better for this warning to have false
      // negatives than false positives.
      rootsWithPendingDiscreteUpdates !== null &&
      workInProgressRoot !== null &&
      renderExpirationTime ===
        rootsWithPendingDiscreteUpdates.get(workInProgressRoot)
    ) {
      // Add the component name to a set.
      const componentName = getComponentName(sourceFiber.type);
      if (componentsWithSuspendedDiscreteUpdates === null) {
        componentsWithSuspendedDiscreteUpdates = new Set([componentName]);
      } else {
        componentsWithSuspendedDiscreteUpdates.add(componentName);
      }
    }
  }
}

function flushSuspensePriorityWarningInDEV() {
  if (__DEV__) {
    if (componentsWithSuspendedDiscreteUpdates !== null) {
      const componentNames = [];
      componentsWithSuspendedDiscreteUpdates.forEach(name => {
        componentNames.push(name);
      });
      componentsWithSuspendedDiscreteUpdates = null;

      // TODO: A more helpful version of this message could include the names of
      // the component that were updated, not the ones that suspended. To do
      // that we'd need to track all the components that updated during this
      // render, perhaps using the same mechanism as `markRenderEventTime`.
      warningWithoutStack(
        false,
        'The following components suspended during a user-blocking update: %s' +
          '\n\n' +
          'Updates triggered by user interactions (e.g. click events) are ' +
          'considered user-blocking by default. They should not suspend. ' +
          'Updates that can afford to take a bit longer should be wrapped ' +
          'with `Scheduler.next` (or an equivalent abstraction). This ' +
          'typically includes any update that shows new content, like ' +
          'a navigation.' +
          '\n\n' +
          'Generally, you should split user interactions into at least two ' +
          'seprate updates: a user-blocking update to provide immediate ' +
          'feedback, and another update to perform the actual change.',
        // TODO: Add link to React docs with more information, once it exists
        componentNames.sort().join(', '),
      );
    }
  }
}

function computeThreadID(root, expirationTime) {
  // Interaction threads are unique per root and expiration time.
  return expirationTime * 1000 + root.interactionThreadID;
}

export function markSpawnedWork(expirationTime: ExpirationTime) {
  if (!enableSchedulerTracing) {
    return;
  }
  if (spawnedWorkDuringRender === null) {
    spawnedWorkDuringRender = [expirationTime];
  } else {
    spawnedWorkDuringRender.push(expirationTime);
  }
}
//与schedule的交互
function scheduleInteractions(root, expirationTime, interactions) {
  if (!enableSchedulerTracing) {
    return;
  }
  //当interactions存在时
  if (interactions.size > 0) {
    //获取FiberRoot的pendingInteractionMap属性
    const pendingInteractionMap = root.pendingInteractionMap;
    //获取pendingInteractions的expirationTime
    const pendingInteractions = pendingInteractionMap.get(expirationTime);
    //如果pendingInteractions不为空的话
    if (pendingInteractions != null) {
      //遍历并更新还未调度的同步任务的数量
      interactions.forEach(interaction => {
        if (!pendingInteractions.has(interaction)) {
          // Update the pending async work count for previously unscheduled interaction.
          interaction.__count++;
        }

        pendingInteractions.add(interaction);
      });
    }
    //否则初始化pendingInteractionMap
    //并统计当前调度中同步任务的数量
    else {
      pendingInteractionMap.set(expirationTime, new Set(interactions));

      // Update the pending async work count for the current interactions.
      interactions.forEach(interaction => {
        interaction.__count++;
      });
    }
    //计算并得出线程的id
    const subscriber = __subscriberRef.current;
    if (subscriber !== null) {
      //这个暂时不看了
      const threadID = computeThreadID(root, expirationTime);
      //检测这些任务是否会报错
      subscriber.onWorkScheduled(interactions, threadID);
    }
  }
}
//跟踪这些update，并计数、检测它们是否会报错
function schedulePendingInteractions(root, expirationTime) {
  // This is called when work is scheduled on a root.
  // It associates the current interactions with the newly-scheduled expiration.
  // They will be restored when that expiration is later committed.
  //当调度开始时就执行，每调度一个update，就更新跟踪栈
  if (!enableSchedulerTracing) {
    return;
  }
  //调度的"交互"
  scheduleInteractions(root, expirationTime, __interactionsRef.current);
}
//将调度优先级高的interaction加入到interactions中
function startWorkOnPendingInteractions(root, expirationTime) {
  // This is called when new work is started on a root.
  if (!enableSchedulerTracing) {
    return;
  }

  // Determine which interactions this batch of work currently includes, So that
  // we can accurately attribute time spent working on it, And so that cascading
  // work triggered during the render phase will be associated with it.
  // 确定这批工作当前包括哪些交互，以便我们可以准确地将花费在工作上的时间归因于此，以便在渲染阶段触发的级联工作将与之相关联。
  const interactions: Set<Interaction> = new Set();
  root.pendingInteractionMap.forEach(
    (scheduledInteractions, scheduledExpirationTime) => {
      if (scheduledExpirationTime >= expirationTime) {
        scheduledInteractions.forEach(interaction =>
          interactions.add(interaction),
        );
      }
    },
  );

  // Store the current set of interactions on the FiberRoot for a few reasons:
  // We can re-use it in hot functions like renderRoot() without having to
  // recalculate it. We will also use it in commitWork() to pass to any Profiler
  // onRender() hooks. This also provides DevTools with a way to access it when
  // the onCommitRoot() hook is called.
  root.memoizedInteractions = interactions;

  if (interactions.size > 0) {
    const subscriber = __subscriberRef.current;
    if (subscriber !== null) {
      const threadID = computeThreadID(root, expirationTime);
      try {
        subscriber.onWorkStarted(interactions, threadID);
      } catch (error) {
        // If the subscriber throws, rethrow it in a separate task
        scheduleCallback(ImmediatePriority, () => {
          throw error;
        });
      }
    }
  }
}
//清除已经完成的交互，如果被 suspended 挂起的话，把交互留到后续呈现
function finishPendingInteractions(root, committedExpirationTime) {
  if (!enableSchedulerTracing) {
    return;
  }

  const earliestRemainingTimeAfterCommit = root.firstPendingTime;

  let subscriber;

  try {
    subscriber = __subscriberRef.current;
    if (subscriber !== null && root.memoizedInteractions.size > 0) {
      const threadID = computeThreadID(root, committedExpirationTime);
      subscriber.onWorkStopped(root.memoizedInteractions, threadID);
    }
  } catch (error) {
    // If the subscriber throws, rethrow it in a separate task
    scheduleCallback(ImmediatePriority, () => {
      throw error;
    });
  } finally {
    // Clear completed interactions from the pending Map.
    // Unless the render was suspended or cascading work was scheduled,
    // In which case– leave pending interactions until the subsequent render.
    const pendingInteractionMap = root.pendingInteractionMap;
    pendingInteractionMap.forEach(
      (scheduledInteractions, scheduledExpirationTime) => {
        // Only decrement the pending interaction count if we're done.
        // If there's still work at the current priority,
        // That indicates that we are waiting for suspense data.
        if (scheduledExpirationTime > earliestRemainingTimeAfterCommit) {
          pendingInteractionMap.delete(scheduledExpirationTime);

          scheduledInteractions.forEach(interaction => {
            interaction.__count--;

            if (subscriber !== null && interaction.__count === 0) {
              try {
                subscriber.onInteractionScheduledWorkCompleted(interaction);
              } catch (error) {
                // If the subscriber throws, rethrow it in a separate task
                scheduleCallback(ImmediatePriority, () => {
                  throw error;
                });
              }
            }
          });
        }
      },
    );
  }
}
