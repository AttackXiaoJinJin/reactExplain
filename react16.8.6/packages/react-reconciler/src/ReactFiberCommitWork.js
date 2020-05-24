/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Instance,
  TextInstance,
  SuspenseInstance,
  Container,
  ChildSet,
  UpdatePayload,
} from './ReactFiberHostConfig';
import type {Fiber} from './ReactFiber';
import type {FiberRoot} from './ReactFiberRoot';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {CapturedValue, CapturedError} from './ReactCapturedValue';
import type {SuspenseState} from './ReactFiberSuspenseComponent';
import type {FunctionComponentUpdateQueue} from './ReactFiberHooks';
import type {Thenable} from './ReactFiberWorkLoop';

import {unstable_wrap as Schedule_tracing_wrap} from 'scheduler/tracing';
import {
  enableSchedulerTracing,
  enableProfilerTimer,
  enableSuspenseServerRenderer,
  enableFlareAPI,
} from 'shared/ReactFeatureFlags';
import {
  FunctionComponent,
  ForwardRef,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  Profiler,
  SuspenseComponent,
  DehydratedSuspenseComponent,
  IncompleteClassComponent,
  MemoComponent,
  SimpleMemoComponent,
  EventComponent,
  SuspenseListComponent,
} from 'shared/ReactWorkTags';
import {
  invokeGuardedCallback,
  hasCaughtError,
  clearCaughtError,
} from 'shared/ReactErrorUtils';
import {
  ContentReset,
  Placement,
  Snapshot,
  Update,
} from 'shared/ReactSideEffectTags';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';
import warningWithoutStack from 'shared/warningWithoutStack';
import warning from 'shared/warning';

import {onCommitUnmount} from './ReactFiberDevToolsHook';
import {startPhaseTimer, stopPhaseTimer} from './ReactDebugFiberPerf';
import {getStackByFiberInDevAndProd} from './ReactCurrentFiber';
import {logCapturedError} from './ReactFiberErrorLogger';
import {resolveDefaultProps} from './ReactFiberLazyComponent';
import {getCommitTime} from './ReactProfilerTimer';
import {commitUpdateQueue} from './ReactUpdateQueue';
import {
  getPublicInstance,
  supportsMutation,
  supportsPersistence,
  commitMount,
  commitUpdate,
  resetTextContent,
  commitTextUpdate,
  appendChild,
  appendChildToContainer,
  insertBefore,
  insertInContainerBefore,
  removeChild,
  removeChildFromContainer,
  clearSuspenseBoundary,
  clearSuspenseBoundaryFromContainer,
  replaceContainerChildren,
  createContainerChildSet,
  hideInstance,
  hideTextInstance,
  unhideInstance,
  unhideTextInstance,
  unmountEventComponent,
  mountEventComponent,
} from './ReactFiberHostConfig';
import {
  captureCommitPhaseError,
  resolveRetryThenable,
  markCommitTimeOfFallback,
} from './ReactFiberWorkLoop';
import {
  NoEffect as NoHookEffect,
  UnmountSnapshot,
  UnmountMutation,
  MountMutation,
  UnmountLayout,
  MountLayout,
  UnmountPassive,
  MountPassive,
} from './ReactHookEffectTags';
import {didWarnAboutReassigningProps} from './ReactFiberBeginWork';

let didWarnAboutUndefinedSnapshotBeforeUpdate: Set<mixed> | null = null;
if (__DEV__) {
  didWarnAboutUndefinedSnapshotBeforeUpdate = new Set();
}

const PossiblyWeakSet = typeof WeakSet === 'function' ? WeakSet : Set;

export function logError(boundary: Fiber, errorInfo: CapturedValue<mixed>) {
  const source = errorInfo.source;
  let stack = errorInfo.stack;
  if (stack === null && source !== null) {
    stack = getStackByFiberInDevAndProd(source);
  }

  const capturedError: CapturedError = {
    componentName: source !== null ? getComponentName(source.type) : null,
    componentStack: stack !== null ? stack : '',
    error: errorInfo.value,
    errorBoundary: null,
    errorBoundaryName: null,
    errorBoundaryFound: false,
    willRetry: false,
  };

  if (boundary !== null && boundary.tag === ClassComponent) {
    capturedError.errorBoundary = boundary.stateNode;
    capturedError.errorBoundaryName = getComponentName(boundary.type);
    capturedError.errorBoundaryFound = true;
    capturedError.willRetry = true;
  }

  try {
    logCapturedError(capturedError);
  } catch (e) {
    // This method must not throw, or React internal state will get messed up.
    // If console.error is overridden, or logCapturedError() shows a dialog that throws,
    // we want to report this error outside of the normal stack as a last resort.
    // https://github.com/facebook/react/issues/13188
    setTimeout(() => {
      throw e;
    });
  }
}
//执行生命周期 API—— componentWillUnmount()
const callComponentWillUnmountWithTimer = function(current, instance) {
  startPhaseTimer(current, 'componentWillUnmount');
  instance.props = current.memoizedProps;
  instance.state = current.memoizedState;
  instance.componentWillUnmount();
  stopPhaseTimer();
};

// Capture errors so they don't interrupt unmounting.
//执行生命周期 API—— componentWillUnmount()
function safelyCallComponentWillUnmount(current, instance) {
  if (__DEV__) {
    //删除了 dev 代码
  } else {
    try {
      //执行生命周期 API—— componentWillUnmount()
      callComponentWillUnmountWithTimer(current, instance);
    } catch (unmountError) {
      captureCommitPhaseError(current, unmountError);
    }
  }
}

function safelyDetachRef(current: Fiber) {
  const ref = current.ref;
  //ref 不为 null，如果是 function，则 ref(null)，否则 ref.current=null
  if (ref !== null) {
    if (typeof ref === 'function') {
      if (__DEV__) {
        //删除了 dev 代码
      } else {
        try {
          ref(null);
        } catch (refError) {
          captureCommitPhaseError(current, refError);
        }
      }
    } else {
      ref.current = null;
    }
  }
}
//安全(try...catch)执行 effect.destroy()
function safelyCallDestroy(current, destroy) {
  if (__DEV__) {
    //删除了 dev 代码
  } else {
    try {
      destroy();
    } catch (error) {
      captureCommitPhaseError(current, error);
    }
  }
}
//classComponent 执行getSnapshotBeforeUpdate生命周期 api，将返回的值赋到fiber 对象的__reactInternalSnapshotBeforeUpdate上
//functionComponent 执行 hooks 上的 effect API
function commitBeforeMutationLifeCycles(
  current: Fiber | null,
  finishedWork: Fiber,
): void {
  switch (finishedWork.tag) {
    //FunctionComponent会执行commitHookEffectList()
    //FunctionComponent是 pureComponent，所以不会有副作用

    //useEffect 和 useLayoutEffect 是赋予FunctionComponent有副作用能力的 hooks
    //useEffect类似于componentDidMount，useLayoutEffect类似于componentDidUpdate
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      //提交 hooks 的 effects
      commitHookEffectList(UnmountSnapshot, NoHookEffect, finishedWork);
      return;
    }
    case ClassComponent: {
      if (finishedWork.effectTag & Snapshot) {
        if (current !== null) {
          //老 props
          const prevProps = current.memoizedProps;
          //老 state
          const prevState = current.memoizedState;
          //getSnapshotBeforeUpdate 的计时开始
          startPhaseTimer(finishedWork, 'getSnapshotBeforeUpdate');
          //获取 classComponent 的实例
          const instance = finishedWork.stateNode;
          // We could update instance props and state here,
          // but instead we rely on them being set during last render.
          // TODO: revisit this when we implement resuming.
          if (__DEV__) {
            //删除了 dev 代码
          }
          //执行 getSnapshotBeforeUpdate 生命周期 api，在组件update前捕获一些 DOM 信息，
          //返回自定义的值或 null，统称为 snapshot
          //关于getSnapshotBeforeUpdate，请参考：https://zh-hans.reactjs.org/docs/react-component.html#getsnapshotbeforeupdate
          const snapshot = instance.getSnapshotBeforeUpdate(
            finishedWork.elementType === finishedWork.type
              ? prevProps
              : resolveDefaultProps(finishedWork.type, prevProps),
            prevState,
          );
          if (__DEV__) {
            //删除了 dev 代码
          }
          //将 snapshot 赋值到__reactInternalSnapshotBeforeUpdate属性上，
          // 这种手法跟[React源码解析之updateClassComponent（上）](https://mp.weixin.qq.com/s/F_UdPgdt6wtP78eDqUesoA)
          // 中的「三、adoptClassInstance」里 instance._reactInternalFiber=workInProgress 类似
          instance.__reactInternalSnapshotBeforeUpdate = snapshot;
          //getSnapshotBeforeUpdate 的计时结束
          stopPhaseTimer();
        }
      }
      return;
    }
    case HostRoot:
    case HostComponent:
    case HostText:
    case HostPortal:
    case IncompleteClassComponent:
      // Nothing to do for these component types
      return;
    //没有副作用，不应该进入到 commit 阶段
    default: {
      invariant(
        false,
        'This unit of work tag should not have side-effects. This error is ' +
          'likely caused by a bug in React. Please file an issue.',
      );
    }
  }
}


//循环 FunctionComponent 上的 effect 链，
//根据hooks 上每个 effect 上的 effectTag，执行destroy/create 操作（类似于 componentDidMount/componentWillUnmount）
function commitHookEffectList(
  unmountTag: number,
  mountTag: number,
  finishedWork: Fiber,
) {
  //FunctionComponent 的更新队列
  //补充：FunctionComponent的 side-effect 是放在 updateQueue.lastEffect 上的
  //ReactFiberHooks.js中的pushEffect()里有说明： componentUpdateQueue.lastEffect = effect.next = effect;
  const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue: any);
  let lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  //如果有副作用 side-effect的话，循环effect 链，根据 effectTag，执行每个 effect
  if (lastEffect !== null) {
    //第一个副作用
    const firstEffect = lastEffect.next;
    let effect = firstEffect;
    do {
      //如果包含 unmountTag 这个 effectTag的话，执行destroy()，并将effect.destroy置为 undefined
      //NoHookEffect即NoEffect
      if ((effect.tag & unmountTag) !== NoHookEffect) {
        // Unmount
        const destroy = effect.destroy;
        effect.destroy = undefined;
        if (destroy !== undefined) {
          destroy();
        }
      }
      //如果包含 mountTag 这个 effectTag 的话，执行 create()
      if ((effect.tag & mountTag) !== NoHookEffect) {
        // Mount
        const create = effect.create;
        effect.destroy = create();

        if (__DEV__) {
          //删除了 dev 代码
        }
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}
//执行 fiber 上的副作用
export function commitPassiveHookEffects(finishedWork: Fiber): void {
  commitHookEffectList(UnmountPassive, NoHookEffect, finishedWork);
  commitHookEffectList(NoHookEffect, MountPassive, finishedWork);
}

//重点看 FunctionComponent/ClassComponent/HostComponent
//① FunctionComponent——执行effect.destroy()/effect.create()
//② ClassComponent——componentDidMount()/componentDidUpdate()，effect 链——执行 setState 的 callback，capturedEffect 链执行 componentDidCatch()
//③ HostComponent——判断是否是自动聚焦的 DOM 标签，是的话则调用 node.focus() 获取焦点
function commitLifeCycles(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
  committedExpirationTime: ExpirationTime,
): void {
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      //循环 FunctionComponent 上的 effect 链，执行 effect.destroy()/create()，类似于 componentWillUnmount()/componentDidMount()
      commitHookEffectList(UnmountLayout, MountLayout, finishedWork);
      break;
    }
    case ClassComponent: {
      const instance = finishedWork.stateNode;
      //有 update 的 effectTag 的话
      if (finishedWork.effectTag & Update) {
        //如果是第一次渲染的话，则执行 componentDidMount()
        if (current === null) {
          startPhaseTimer(finishedWork, 'componentDidMount');
          // We could update instance props and state here,
          // but instead we rely on them being set during last render.
          // TODO: revisit this when we implement resuming.
          if (__DEV__) {
            //删除了 dev 代码
          }
          instance.componentDidMount();
          stopPhaseTimer();
        }
        //如果是多次渲染的话，则执行 componentDidUpdate()
        else {
          const prevProps =
            finishedWork.elementType === finishedWork.type
              ? current.memoizedProps
              : resolveDefaultProps(finishedWork.type, current.memoizedProps);
          const prevState = current.memoizedState;
          startPhaseTimer(finishedWork, 'componentDidUpdate');
          // We could update instance props and state here,
          // but instead we rely on them being set during last render.
          // TODO: revisit this when we implement resuming.
          //删除了 dev 代码
          if (__DEV__) {

          }
          instance.componentDidUpdate(
            prevProps,
            prevState,
            instance.__reactInternalSnapshotBeforeUpdate,
          );
          stopPhaseTimer();
        }
      }
      const updateQueue = finishedWork.updateQueue;
      //如果更新队列不为空的话
      if (updateQueue !== null) {
        //删除了 dev 代码
        if (__DEV__) {

        }
        // We could update instance props and state here,
        // but instead we rely on them being set during last render.
        // TODO: revisit this when we implement resuming.
        //将 capturedUpdate 队列放到 update 队列末尾
        //循环 effect 链，执行 setState() 的 callback
        //清除 effect 链
        //循环 capturedEffect 链，执行 componentDidCatch()
        //清除 capturedEffect 链
        commitUpdateQueue(
          finishedWork,
          updateQueue,
          instance,
          committedExpirationTime,
        );
      }
      return;
    }
    //fiberRoot 节点，暂时跳过
    case HostRoot: {
      const updateQueue = finishedWork.updateQueue;
      if (updateQueue !== null) {
        let instance = null;
        if (finishedWork.child !== null) {
          switch (finishedWork.child.tag) {
            case HostComponent:
              instance = getPublicInstance(finishedWork.child.stateNode);
              break;
            case ClassComponent:
              instance = finishedWork.child.stateNode;
              break;
          }
        }
        commitUpdateQueue(
          finishedWork,
          updateQueue,
          instance,
          committedExpirationTime,
        );
      }
      return;
    }
    //DOM 标签
    case HostComponent: {
      const instance: Instance = finishedWork.stateNode;

      // Renderers may schedule work to be done after host components are mounted
      // (eg DOM renderer may schedule auto-focus for inputs and form controls).
      // These effects should only be committed when components are first mounted,
      // aka when there is no current/alternate.
      //如果是第一次渲染，并且该节点需要更新的话，就需要判断是否是自动聚焦的 DOM 标签
      if (current === null && finishedWork.effectTag & Update) {
        const type = finishedWork.type;
        const props = finishedWork.memoizedProps;
        // 判断是否是自动聚焦的 DOM 标签
        commitMount(instance, type, props, finishedWork);
      }

      return;
    }
    //文本节点，无生命周期方法
    case HostText: {
      // We have no life-cycles associated with text.
      return;
    }
    case HostPortal: {
      // We have no life-cycles associated with portals.
      return;
    }
    //以下的情况也跳过
    case Profiler: {
      if (enableProfilerTimer) {
        const onRender = finishedWork.memoizedProps.onRender;

        if (enableSchedulerTracing) {
          onRender(
            finishedWork.memoizedProps.id,
            current === null ? 'mount' : 'update',
            finishedWork.actualDuration,
            finishedWork.treeBaseDuration,
            finishedWork.actualStartTime,
            getCommitTime(),
            finishedRoot.memoizedInteractions,
          );
        } else {
          onRender(
            finishedWork.memoizedProps.id,
            current === null ? 'mount' : 'update',
            finishedWork.actualDuration,
            finishedWork.treeBaseDuration,
            finishedWork.actualStartTime,
            getCommitTime(),
          );
        }
      }
      return;
    }
    case SuspenseComponent:
    case SuspenseListComponent:
    case IncompleteClassComponent:
      return;
    case EventComponent: {
      if (enableFlareAPI) {
        mountEventComponent(finishedWork.stateNode);
      }
      return;
    }
    default: {
      invariant(
        false,
        'This unit of work tag should not have side-effects. This error is ' +
          'likely caused by a bug in React. Please file an issue.',
      );
    }
  }
}

function hideOrUnhideAllChildren(finishedWork, isHidden) {
  if (supportsMutation) {
    // We only have the top Fiber that was inserted but we need to recurse down its
    // children to find all the terminal nodes.
    let node: Fiber = finishedWork;
    while (true) {
      if (node.tag === HostComponent) {
        const instance = node.stateNode;
        if (isHidden) {
          hideInstance(instance);
        } else {
          unhideInstance(node.stateNode, node.memoizedProps);
        }
      } else if (node.tag === HostText) {
        const instance = node.stateNode;
        if (isHidden) {
          hideTextInstance(instance);
        } else {
          unhideTextInstance(instance, node.memoizedProps);
        }
      } else if (
        node.tag === SuspenseComponent &&
        node.memoizedState !== null
      ) {
        // Found a nested Suspense component that timed out. Skip over the
        // primary child fragment, which should remain hidden.
        const fallbackChildFragment: Fiber = (node.child: any).sibling;
        fallbackChildFragment.return = node;
        node = fallbackChildFragment;
        continue;
      } else if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
      if (node === finishedWork) {
        return;
      }
      while (node.sibling === null) {
        if (node.return === null || node.return === finishedWork) {
          return;
        }
        node = node.return;
      }
      node.sibling.return = node.return;
      node = node.sibling;
    }
  }
}
//获取 instance 实例，并指定给 ref
function commitAttachRef(finishedWork: Fiber) {
  const ref = finishedWork.ref;
  if (ref !== null) {
    const instance = finishedWork.stateNode;
    let instanceToUse;
    //获取可使用的 instance(实例)
    switch (finishedWork.tag) {
      //DOM标签
      case HostComponent:
        instanceToUse = getPublicInstance(instance);
        break;
      default:
        instanceToUse = instance;
    }
    //指定 ref 的引用
    if (typeof ref === 'function') {
      ref(instanceToUse);
    } else {
      //删除了 dev 代码
      ref.current = instanceToUse;
    }
  }
}
//将 ref 的指向置为 null
function commitDetachRef(current: Fiber) {
  const currentRef = current.ref;
  if (currentRef !== null) {
    if (typeof currentRef === 'function') {
      currentRef(null);
    } else {
      currentRef.current = null;
    }
  }
}

// User-originating errors (lifecycles and refs) should not interrupt
// deletion, so don't let them throw. Host-originating errors should
// interrupt deletion, so it's okay

//卸载 ref 和执行 componentWillUnmount()/effect.destroy()
function commitUnmount(current: Fiber): void {
  //执行onCommitFiberUnmount()，查了下是个空 function
  onCommitUnmount(current);

  switch (current.tag) {
    //如果是 FunctionComponent 的话
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      //下面代码结构和[React源码解析之Commit第一子阶段「before mutation」](https://mp.weixin.qq.com/s/YtgEVlZz1i5Yp87HrGrgRA)中的「三、commitHookEffectList()」相似
      //大致思路是循环 effect 链，执行每个 effect 上的 destory()
      const updateQueue: FunctionComponentUpdateQueue | null = (current.updateQueue: any);
      if (updateQueue !== null) {
        const lastEffect = updateQueue.lastEffect;
        if (lastEffect !== null) {
          const firstEffect = lastEffect.next;
          let effect = firstEffect;
          do {
            const destroy = effect.destroy;
            if (destroy !== undefined) {
              //安全(try...catch)执行 effect.destroy()
              safelyCallDestroy(current, destroy);
            }
            effect = effect.next;
          } while (effect !== firstEffect);
        }
      }
      break;
    }
    //如果是 ClassComponent 的话
    case ClassComponent: {
      //安全卸载 ref
      safelyDetachRef(current);
      const instance = current.stateNode;
      //执行生命周期 API—— componentWillUnmount()
      if (typeof instance.componentWillUnmount === 'function') {
        safelyCallComponentWillUnmount(current, instance);
      }
      return;
    }
    //如果是 DOM 标签的话
    case HostComponent: {
      //安全卸载 ref
      safelyDetachRef(current);
      return;
    }
    //portal 不看
    case HostPortal: {
      // TODO: this is recursive.
      // We are also not using this parent because
      // the portal will get pushed immediately.
      if (supportsMutation) {
        unmountHostComponents(current);
      } else if (supportsPersistence) {
        emptyPortalContainer(current);
      }
      return;
    }
    //事件组件 的更新，暂未找到相关资料
    case EventComponent: {
      if (enableFlareAPI) {
        const eventComponentInstance = current.stateNode;
        unmountEventComponent(eventComponentInstance);
        current.stateNode = null;
      }
    }
  }
}
//在目标节点被删除前，从该节点开始深度优先遍历，卸载该节点及其子节点 ref 和执行该节点及其子节点 componentWillUnmount()/effect.destroy()
function commitNestedUnmounts(root: Fiber): void {
  // While we're inside a removed host node we don't want to call
  // removeChild on the inner nodes because they're removed by the top
  // call anyway. We also want to call componentWillUnmount on all
  // composites before this host node is removed from the tree. Therefore
  // we do an inner loop while we're still inside the host node.
  //当在被删除的目标节点的内部时，我们不想在内部调用removeChild，因为子节点会被父节点给统一删除
  //但是 React 要在目标节点被删除的时候，执行componentWillUnmount，这就是commitNestedUnmounts的目的
  let node: Fiber = root;
  while (true) {
    // 卸载 ref 和执行 componentWillUnmount()/effect.destroy()
    commitUnmount(node);
    // Visit children because they may contain more composite or host nodes.
    // Skip portals because commitUnmount() currently visits them recursively.
    if (
      node.child !== null &&
      // If we use mutation we drill down into portals using commitUnmount above.
      // If we don't use mutation we drill down into portals here instead.
      (!supportsMutation || node.tag !== HostPortal)
    ) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === root) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === root) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}
//重置 fiber 对象，释放内存(注意是属性值置为 null，不会删除属性)
function detachFiber(current: Fiber) {
  // Cut off the return pointers to disconnect it from the tree. Ideally, we
  // should clear the child pointer of the parent alternate to let this
  // get GC:ed but we don't know which for sure which parent is the current
  // one so we'll settle for GC:ing the subtree of this child. This child
  // itself will be GC:ed when the parent updates the next time.

  //重置目标 fiber对象，理想情况下，也应该清除父 fiber的指向(该 fiber)，这样有利于垃圾回收
  //但是 React确定不了父节点，所以会在目标 fiber 下生成一个子 fiber，代表垃圾回收，该子节点
  //会在父节点更新的时候，成为垃圾回收
  current.return = null;
  current.child = null;
  current.memoizedState = null;
  current.updateQueue = null;
  current.dependencies = null;
  const alternate = current.alternate;
  //使用的doubleBuffer技术，Fiber在更新后，不用再重新创建对象，而是复制自身，并且两者相互复用，用来提高性能
  //相当于是当前 fiber 的一个副本，用来节省内存用的，也要清空属性
  if (alternate !== null) {
    alternate.return = null;
    alternate.child = null;
    alternate.memoizedState = null;
    alternate.updateQueue = null;
    alternate.dependencies = null;
  }
}

function emptyPortalContainer(current: Fiber) {
  if (!supportsPersistence) {
    return;
  }

  const portal: {containerInfo: Container, pendingChildren: ChildSet} =
    current.stateNode;
  const {containerInfo} = portal;
  const emptyChildSet = createContainerChildSet(containerInfo);
  replaceContainerChildren(containerInfo, emptyChildSet);
}

function commitContainer(finishedWork: Fiber) {
  if (!supportsPersistence) {
    return;
  }

  switch (finishedWork.tag) {
    case ClassComponent:
    case HostComponent:
    case HostText:
    case EventComponent: {
      return;
    }
    case HostRoot:
    case HostPortal: {
      const portalOrRoot: {
        containerInfo: Container,
        pendingChildren: ChildSet,
      } =
        finishedWork.stateNode;
      const {containerInfo, pendingChildren} = portalOrRoot;
      replaceContainerChildren(containerInfo, pendingChildren);
      return;
    }
    default: {
      invariant(
        false,
        'This unit of work tag should not have side-effects. This error is ' +
          'likely caused by a bug in React. Please file an issue.',
      );
    }
  }
}
//向上循环祖先节点，返回是 DOM 元素的父节点
function getHostParentFiber(fiber: Fiber): Fiber {
  let parent = fiber.return;
  //向上循环祖先节点，返回是 DOM 元素的父节点
  while (parent !== null) {
    //父节点是 DOM 元素的话，返回其父节点
    if (isHostParent(parent)) {
      return parent;
    }
    parent = parent.return;
  }
  invariant(
    false,
    'Expected to find a host parent. This error is likely caused by a bug ' +
      'in React. Please file an issue.',
  );
}
//判断目标节点是否是 DOM 节点
function isHostParent(fiber: Fiber): boolean {
  return (
    fiber.tag === HostComponent ||
    fiber.tag === HostRoot ||
    fiber.tag === HostPortal
  );
}
//查找插入节点的位置，也就是获取它后一个 DOM 兄弟节点的位置
//比如：在ab上，插入 c，插在 b 之前，找到兄弟节点 b；插在 b 之后，无兄弟节点
function getHostSibling(fiber: Fiber): ?Instance {
  // We're going to search forward into the tree until we find a sibling host
  // node. Unfortunately, if multiple insertions are done in a row we have to
  // search past them. This leads to exponential search for the next sibling.
  // TODO: Find a more efficient way to do this.
  let node: Fiber = fiber;
  //将外部 while 循环命名为 siblings，以便和内部 while 循环区分开
  siblings: while (true) {
    // If we didn't find anything, let's try the next sibling.
    //从目标节点向上循环，如果该节点没有兄弟节点，并且 父节点为 null 或是 父节点是DOM 元素的话，跳出循环

    //例子：树
    //     a
    //    /
    //   b
    // 在 a、b之间插入 c，那么 c 是没有兄弟节点的，直接返回 null
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        // If we pop out of the root or hit the parent the fiber we are the
        // last sibling.
        return null;
      }
      node = node.return;
    }
    //node 的兄弟节点的 return 指向 node 的父节点
    node.sibling.return = node.return;
    //移到兄弟节点上
    node = node.sibling;
    //如果 node.silbing 不是 DOM 元素的话（即是一个组件）
    //查找(node 的兄弟节点)(node.sibling) 中的第一个 DOM 节点
    while (
      node.tag !== HostComponent &&
      node.tag !== HostText &&
      node.tag !== DehydratedSuspenseComponent
    ) {
      // If it is not host node and, we might have a host node inside it.
      // Try to search down until we find one.
      //尝试在非 DOM 节点内，找到 DOM 节点

      //跳出本次 while 循环，继续siblings while 循环
      if (node.effectTag & Placement) {
        // If we don't have a child, try the siblings instead.
        continue siblings;
      }
      // If we don't have a child, try the siblings instead.
      // We also skip portals because they are not part of this host tree.
      //如果 node 没有子节点，则从兄弟节点查找
      if (node.child === null || node.tag === HostPortal) {
        continue siblings;
      }
      //循环子节点
      //找到兄弟节点上的第一个 DOM 节点
      else {
        node.child.return = node;
        node = node.child;
      }
    }
    // Check if this host node is stable or about to be placed.
    //找到了要插入的 node 的兄弟节点是一个 DOM 元素，并且它不是新增的节点的话，
    //返回该节点，也就是说找到了要插入的节点的位置，即在该节点的前面
    if (!(node.effectTag & Placement)) {
      // Found it!
      return node.stateNode;
    }
  }
}

//插入新节点
function commitPlacement(finishedWork: Fiber): void {
  if (!supportsMutation) {
    return;
  }

  // Recursively insert all host nodes into the parent.
  //向上循环祖先节点，返回是 DOM 元素的父节点
  const parentFiber = getHostParentFiber(finishedWork);

  // Note: these two variables *must* always be updated together.
  let parent;
  let isContainer;
  //判断父节点的类型
  switch (parentFiber.tag) {
    //如果是 DOM 元素的话
    case HostComponent:
      //获取对应的 DOM 节点
      parent = parentFiber.stateNode;
      isContainer = false;
      break;
    //如果是 fiberRoot 节点的话，
    //关于 fiberRoot ，请看：[React源码解析之FiberRoot](https://mp.weixin.qq.com/s/AYzNSoMXEFR5XC4xQ3L8gA)
    case HostRoot:
      parent = parentFiber.stateNode.containerInfo;
      isContainer = true;
      break;
    //React.createportal 节点的更新
    //https://zh-hans.reactjs.org/docs/react-dom.html#createportal
    case HostPortal:
      parent = parentFiber.stateNode.containerInfo;
      isContainer = true;
      break;
    default:
      invariant(
        false,
        'Invalid host parent fiber. This error is likely caused by a bug ' +
          'in React. Please file an issue.',
      );
  }
  //如果父节点是文本节点的话
  if (parentFiber.effectTag & ContentReset) {
    // Reset the text content of the parent before doing any insertions
    //在进行任何插入操作前，需要先将 value 置为 ''
    resetTextContent(parent);
    // Clear ContentReset from the effect tag
    //再清除掉 ContentReset 这个 effectTag
    parentFiber.effectTag &= ~ContentReset;
  }
  //查找插入节点的位置，也就是获取它后一个 DOM 兄弟节点的位置
  const before = getHostSibling(finishedWork);
  // We only have the top Fiber that was inserted but we need to recurse down its
  // children to find all the terminal nodes.
  //循环，找到所有子节点
  let node: Fiber = finishedWork;
  while (true) {
    //如果待插入的节点是一个 DOM 元素的话
    if (node.tag === HostComponent || node.tag === HostText) {
      //获取 fiber 节点对应的 DOM 元素
      const stateNode = node.stateNode;
      //找到了待插入的位置，比如 before 是 div，就表示在 div 的前面插入 stateNode
      if (before) {
        //父节点不是 DOM 元素的话
        if (isContainer) {
          insertInContainerBefore(parent, stateNode, before);
        }
        //父节点是 DOM 元素的话，执行DOM API--insertBefore()
        //https://developer.mozilla.org/zh-CN/docs/Web/API/Node/insertBefore
        else {
          //parentInstance.insertBefore(child, beforeChild);
          insertBefore(parent, stateNode, before);
        }
      }
      //插入的是节点是没有兄弟节点的话，执行 appendChild
      //https://developer.mozilla.org/zh-CN/docs/Web/API/Node/appendChild
      else {
        if (isContainer) {
          appendChildToContainer(parent, stateNode);
        } else {
          appendChild(parent, stateNode);
        }
      }
    }
    else if (node.tag === HostPortal) {
      // If the insertion itself is a portal, then we don't want to traverse
      // down its children. Instead, we'll get insertions from each child in
      // the portal directly.
    }
    //如果是组件节点的话，比如 ClassComponent，则找它的第一个子节点（DOM 元素），进行插入操作
    else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === finishedWork) {
      return;
    }
    //如果待插入的节点是 ClassComponent 或 FunctionComponent 的话，还要执行内部节点的插入操作
    //也就是说组件内部可能还有多个子组件，也是要循环插入的

    //当没有兄弟节点，也就是目前的节点是最后一个节点的话
    while (node.sibling === null) {
      //循环周期结束，返回到了最初的节点上，则插入操作已经全部结束
      if (node.return === null || node.return === finishedWork) {
        return;
      }
      //从下至上，从左至右，查找要插入的兄弟节点
      node = node.return;
    }
    //移到兄弟节点，判断是否是要插入的节点，一直循环
    node.sibling.return = node.return;
    node = node.sibling;
  }
}
//循环遍历子树和兄弟节点，卸载 ref 和执行 componentWillUnmount()/effect.destroy()
function unmountHostComponents(current): void {
  // We only have the top Fiber that was deleted but we need to recurse down its
  // children to find all the terminal nodes.
  let node: Fiber = current;

  // Each iteration, currentParent is populated with node's host parent if not
  // currentParentIsValid.
  let currentParentIsValid = false;

  // Note: these two variables *must* always be updated together.
  let currentParent;
  let currentParentIsContainer;
  //从上至下，遍历兄弟节点、子节点
  while (true) {
    if (!currentParentIsValid) {
      //获取父节点
      let parent = node.return;
      //将此 while 循环命名为 findParent
      //此循环的目的是找到是 DOM 类型的父节点
      findParent: while (true) {
        invariant(
          parent !== null,
          'Expected to find a host parent. This error is likely caused by ' +
            'a bug in React. Please file an issue.',
        );
        switch (parent.tag) {
          case HostComponent:
            //获取父节点对应的 DOM 元素
            currentParent = parent.stateNode;
            currentParentIsContainer = false;
            break findParent;
          case HostRoot:
            currentParent = parent.stateNode.containerInfo;
            currentParentIsContainer = true;
            break findParent;
          case HostPortal:
            currentParent = parent.stateNode.containerInfo;
            currentParentIsContainer = true;
            break findParent;
        }
        parent = parent.return;
      }
      //执行到这边，说明找到了符合条件的父节点
      currentParentIsValid = true;
    }
    //如果是 DOM 元素或文本元素的话(主要看这个)
    if (node.tag === HostComponent || node.tag === HostText) {
      //在目标节点被删除前，从该节点开始深度优先遍历，卸载 ref 和执行 componentWillUnmount()/effect.destroy()
      commitNestedUnmounts(node);
      // After all the children have unmounted, it is now safe to remove the
      // node from the tree.
      //我们只看 false 的情况，也就是操作 DOM 标签的情况
      //currentParentIsContainer=false
      if (currentParentIsContainer) {
        removeChildFromContainer(
          ((currentParent: any): Container),
          (node.stateNode: Instance | TextInstance),
        );
      }

      else {
        //源码：parentInstance.removeChild(child);
        removeChild(
          ((currentParent: any): Instance),
          (node.stateNode: Instance | TextInstance),
        );
      }
      // Don't visit children because we already visited them.
    }
    //suspense 组件不看
    else if (
      enableSuspenseServerRenderer &&
      node.tag === DehydratedSuspenseComponent
    ) {
      //不看这部分
    }
    //portal 不看
    else if (node.tag === HostPortal) {
      //不看这部分
    }
    //上述情况都不符合，可能是一个 Component 组件
    else {
      //卸载 ref 和执行 componentWillUnmount()/effect.destroy()
      commitUnmount(node);
      // Visit children because we may find more host components below.
      if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
    }
    //子树已经遍历完
    if (node === current) {
      return;
    }
    while (node.sibling === null) {
      //如果遍历回顶点 或 遍历完子树，则直接 return
      if (node.return === null || node.return === current) {
        return;
      }
      //否则向上遍历，向兄弟节点遍历
      node = node.return;
      if (node.tag === HostPortal) {
        // When we go out of the portal, we need to restore the parent.
        // Since we don't keep a stack of them, we will search for it.
        currentParentIsValid = false;
      }
    }
    // 向上遍历，向兄弟节点遍历
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function commitDeletion(current: Fiber): void {
  //因为是 DOM 操作，所以supportsMutation为 true
  if (supportsMutation) {
    // Recursively delete all host nodes from the parent.
    // Detach refs and call componentWillUnmount() on the whole subtree.

    //删除该节点的时候，还会删除子节点
    //如果子节点是 ClassComponent 的话，需要执行生命周期 API——componentWillUnmount()
    unmountHostComponents(current);
  } else {
    // Detach refs and call componentWillUnmount() on the whole subtree.
    //卸载 ref
    commitNestedUnmounts(current);
  }
  //重置 fiber 属性
  detachFiber(current);
}
//对 DOM 节点上的属性进行更新
function commitWork(current: Fiber | null, finishedWork: Fiber): void {
  //因为是执行 DOM 操作，所以supportsMutation为 true，下面这一段不看
  if (!supportsMutation) {
    //删除了本情况代码
  }

  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // Note: We currently never use MountMutation, but useLayout uses
      // UnmountMutation.

      //循环 FunctionComponent 上的 effect 链，
      //根据hooks 上每个 effect 上的 effectTag，执行destroy/create 操作（类似于 componentDidMount/componentWillUnmount）
      //详情请看：[React源码解析之Commit第一子阶段「before mutation」](https://mp.weixin.qq.com/s/YtgEVlZz1i5Yp87HrGrgRA)中的「三、commitHookEffectList()」
      commitHookEffectList(UnmountMutation, MountMutation, finishedWork);
      return;
    }
    case ClassComponent: {
      return;
    }
    //DOM 节点的话
    case HostComponent: {
      const instance: Instance = finishedWork.stateNode;
      if (instance != null) {
        // Commit the work prepared earlier.
        //待更新的属性
        const newProps = finishedWork.memoizedProps;
        // For hydration we reuse the update path but we treat the oldProps
        // as the newProps. The updatePayload will contain the real change in
        // this case.
        //旧的属性
        const oldProps = current !== null ? current.memoizedProps : newProps;
        const type = finishedWork.type;
        // TODO: Type the updateQueue to be specific to host components.
        //需要更新的属性的集合
        //比如：['style',{height:14},'__html',xxxx,...]
        //关于updatePayload，请看:
        // [React源码解析之HostComponent的更新(上)](https://juejin.im/post/5e5c5e1051882549003d1fc7)中的「四、diffProperties」
        const updatePayload: null | UpdatePayload = (finishedWork.updateQueue: any);
        finishedWork.updateQueue = null;
        //进行节点的更新
        if (updatePayload !== null) {
          commitUpdate(
            instance,
            updatePayload,
            type,
            oldProps,
            newProps,
            finishedWork,
          );
        }
      }
      return;
    }
    case HostText: {
      invariant(
        finishedWork.stateNode !== null,
        'This should have a text node initialized. This error is likely ' +
          'caused by a bug in React. Please file an issue.',
      );
      const textInstance: TextInstance = finishedWork.stateNode;
      const newText: string = finishedWork.memoizedProps;
      // For hydration we reuse the update path but we treat the oldProps
      // as the newProps. The updatePayload will contain the real change in
      // this case.
      const oldText: string =
        current !== null ? current.memoizedProps : newText;
      //源码即：textInstance.nodeValue = newText;
      commitTextUpdate(textInstance, oldText, newText);
      return;
    }
    case HostRoot: {
      return;
    }
    case Profiler: {
      return;
    }
    case SuspenseComponent: {
      commitSuspenseComponent(finishedWork);
      attachSuspenseRetryListeners(finishedWork);
      return;
    }
    case SuspenseListComponent: {
      attachSuspenseRetryListeners(finishedWork);
      return;
    }
    case IncompleteClassComponent: {
      return;
    }
    case EventComponent: {
      return;
    }
    default: {
      invariant(
        false,
        'This unit of work tag should not have side-effects. This error is ' +
          'likely caused by a bug in React. Please file an issue.',
      );
    }
  }
}

function commitSuspenseComponent(finishedWork: Fiber) {
  let newState: SuspenseState | null = finishedWork.memoizedState;

  let newDidTimeout;
  let primaryChildParent = finishedWork;
  if (newState === null) {
    newDidTimeout = false;
  } else {
    newDidTimeout = true;
    primaryChildParent = finishedWork.child;
    markCommitTimeOfFallback();
  }

  if (supportsMutation && primaryChildParent !== null) {
    hideOrUnhideAllChildren(primaryChildParent, newDidTimeout);
  }
}

function attachSuspenseRetryListeners(finishedWork: Fiber) {
  // If this boundary just timed out, then it will have a set of thenables.
  // For each thenable, attach a listener so that when it resolves, React
  // attempts to re-render the boundary in the primary (pre-timeout) state.
  const thenables: Set<Thenable> | null = (finishedWork.updateQueue: any);
  if (thenables !== null) {
    finishedWork.updateQueue = null;
    let retryCache = finishedWork.stateNode;
    if (retryCache === null) {
      retryCache = finishedWork.stateNode = new PossiblyWeakSet();
    }
    thenables.forEach(thenable => {
      // Memoize using the boundary fiber to prevent redundant listeners.
      let retry = resolveRetryThenable.bind(null, finishedWork, thenable);
      if (!retryCache.has(thenable)) {
        if (enableSchedulerTracing) {
          retry = Schedule_tracing_wrap(retry);
        }
        retryCache.add(thenable);
        thenable.then(retry, retry);
      }
    });
  }
}
//重置文字内容
function commitResetTextContent(current: Fiber) {
  if (!supportsMutation) {
    return;
  }
  resetTextContent(current.stateNode);
}

export {
  commitBeforeMutationLifeCycles,
  commitResetTextContent,
  commitPlacement,
  commitDeletion,
  commitWork,
  commitLifeCycles,
  commitAttachRef,
  commitDetachRef,
};
