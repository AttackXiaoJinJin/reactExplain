/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {RootTag} from 'shared/ReactRootTags';
import type {TimeoutHandle, NoTimeout} from './ReactFiberHostConfig';
import type {Thenable} from './ReactFiberWorkLoop';
import type {Interaction} from 'scheduler/src/Tracing';

import {noTimeout} from './ReactFiberHostConfig';
import {createHostRootFiber} from './ReactFiber';
import {NoWork} from './ReactFiberExpirationTime';
import {enableSchedulerTracing} from 'shared/ReactFeatureFlags';
import {unstable_getThreadID} from 'scheduler/tracing';

// TODO: This should be lifted into the renderer.
export type Batch = {
  _defer: boolean,
  _expirationTime: ExpirationTime,
  _onComplete: () => mixed,
  _next: Batch | null,
};

export type PendingInteractionMap = Map<ExpirationTime, Set<Interaction>>;

type BaseFiberRootProperties = {|
  // The type of root (legacy, batched, concurrent, etc.)
  tag: RootTag,

  // Any additional information from the host associated with this root.
  //root节点，也就是ReactDOM.render(<App />, document.getElementById('root'))的第二个参数
  containerInfo: any,
  // Used only by persistent updates.
  //只有在持久更新中才会用到，也就是不支持增量更新的平台会用到，react-dom不会用到
  //也就是不更新某一块地方，而是整个应用完全更新
  pendingChildren: any,
  // The currently active root fiber. This is the mutable root of the tree.
  //当前应用root节点对应的Fiber对象，即Root Fiber
  //ReactElement会有一个树结构，同时一个ReactElement对应一个Fiber对象，
  //所以Fiber也会有树结构
  //current:Fiber对象 对应的是 root 节点，即整个应用根对象
  current: Fiber,

  pingCache:
    | WeakMap<Thenable, Set<ExpirationTime>>
    | Map<Thenable, Set<ExpirationTime>>
    | null,

  //任务有三种，优先级有高低：
  //（1）没有提交的任务
  //（2）没有提交的被挂起的任务
  //（3）没有提交的可能被挂起的任务

  //当前更新对应的过期时间
  finishedExpirationTime: ExpirationTime,
  // A finished work-in-progress HostRoot that's ready to be committed.
  //已经完成任务的FiberRoot对象，如果你只有一个Root，那么该对象就是这个Root对应的Fiber或null
  //在commit(提交)阶段只会处理该值对应的任务
  finishedWork: Fiber | null,
  // Timeout handle returned by setTimeout. Used to cancel a pending timeout, if
  // it's superseded by a new one.
  // 在任务被挂起的时候，通过setTimeout设置的响应内容，
  // 并且清理之前挂起的任务 还没触发的timeout
  timeoutHandle: TimeoutHandle | NoTimeout,
  // Top context object, used by renderSubtreeIntoContainer
  //顶层context对象，只有主动调用renderSubtreeIntoContainer才会生效
  context: Object | null,
  pendingContext: Object | null,
  // Determines if we should attempt to hydrate on the initial mount
  //用来判断 第一次渲染 是否需要融合
  +hydrate: boolean,
  // List of top-level batches. This list indicates whether a commit should be
  // deferred. Also contains completion callbacks.
  // TODO: Lift this into the renderer
  firstBatch: Batch | null,
  // Node returned by Scheduler.scheduleCallback
  callbackNode: *,
  // Expiration of the callback associated with this root
  //跟root有关联的回调函数的时间
  callbackExpirationTime: ExpirationTime,
  // The earliest pending expiration time that exists in the tree
  //存在root中，最旧的挂起时间
  //不确定是否挂起的状态（所有任务一开始均是该状态）
  firstPendingTime: ExpirationTime,
  // The latest pending expiration time that exists in the tree
  //存在root中，最新的挂起时间
  //不确定是否挂起的状态（所有任务一开始均是该状态）
  lastPendingTime: ExpirationTime,
  // The time at which a suspended component pinged the root to render again
  //挂起的组件通知root再次渲染的时间
  //通过一个promise被reslove并且可以重新尝试的优先级
  pingTime: ExpirationTime,
|};

// The following attributes are only used by interaction tracing builds.
// They enable interactions to be associated with their async work,
// And expose interaction metadata to the React DevTools Profiler plugin.
// Note that these attributes are only defined when the enableSchedulerTracing flag is enabled.
type ProfilingOnlyFiberRootProperties = {|
  interactionThreadID: number,
  memoizedInteractions: Set<Interaction>,
  pendingInteractionMap: PendingInteractionMap,
|};

// Exported FiberRoot type includes all properties,
// To avoid requiring potentially error-prone :any casts throughout the project.
// Profiling properties are only safe to access in profiling builds (when enableSchedulerTracing is true).
// The types are defined separately within this file to ensure they stay in sync.
// (We don't have to use an inline :any cast when enableSchedulerTracing is disabled.)
export type FiberRoot = {
  ...BaseFiberRootProperties,
  ...ProfilingOnlyFiberRootProperties,
};
//新建fiberRoot对象
function FiberRootNode(containerInfo, tag, hydrate) {
  this.tag = tag;
  this.current = null;
  this.containerInfo = containerInfo;
  this.pendingChildren = null;
  this.pingCache = null;
  this.finishedExpirationTime = NoWork;
  this.finishedWork = null;
  this.timeoutHandle = noTimeout;
  this.context = null;
  this.pendingContext = null;
  this.hydrate = hydrate;
  this.firstBatch = null;
  this.callbackNode = null;
  this.callbackExpirationTime = NoWork;
  this.firstPendingTime = NoWork;
  this.lastPendingTime = NoWork;
  this.pingTime = NoWork;

  if (enableSchedulerTracing) {
    this.interactionThreadID = unstable_getThreadID();
    this.memoizedInteractions = new Set();
    this.pendingInteractionMap = new Map();
  }
}
//初始化fiberRoot和rootFiber
export function createFiberRoot(
  containerInfo: any,
  tag: RootTag,
  hydrate: boolean,
): FiberRoot {
  //新建fiberRoot对象
  const root: FiberRoot = (new FiberRootNode(containerInfo, tag, hydrate): any);

  // Cyclic construction. This cheats the type system right now because
  // stateNode is any.
  //初始化RootFiber
  const uninitializedFiber = createHostRootFiber(tag);
  //FiberRoot和RootFiber的关系
  //FiberRoot.current = RootFiber
  root.current = uninitializedFiber;
  //RootFiber.stateNode = FiberRoot
  uninitializedFiber.stateNode = root;

  return root;
}
