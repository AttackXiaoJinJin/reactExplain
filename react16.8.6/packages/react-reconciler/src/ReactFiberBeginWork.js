/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactProviderType, ReactContext} from 'shared/ReactTypes';
import type {Fiber} from './ReactFiber';
import type {FiberRoot} from './ReactFiberRoot';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {
  SuspenseState,
  SuspenseListRenderState,
  SuspenseListTailMode,
} from './ReactFiberSuspenseComponent';
import type {SuspenseContext} from './ReactFiberSuspenseContext';

import checkPropTypes from 'prop-types/checkPropTypes';

import {
  IndeterminateComponent,
  FunctionComponent,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  ForwardRef,
  Fragment,
  Mode,
  ContextProvider,
  ContextConsumer,
  Profiler,
  SuspenseComponent,
  SuspenseListComponent,
  DehydratedSuspenseComponent,
  MemoComponent,
  SimpleMemoComponent,
  LazyComponent,
  IncompleteClassComponent,
  EventComponent,
} from 'shared/ReactWorkTags';
import {
  NoEffect,
  PerformedWork,
  Placement,
  ContentReset,
  DidCapture,
  Update,
  Ref,
  Deletion,
} from 'shared/ReactSideEffectTags';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  debugRenderPhaseSideEffects,
  debugRenderPhaseSideEffectsForStrictMode,
  enableProfilerTimer,
  enableSchedulerTracing,
  enableSuspenseServerRenderer,
  enableFlareAPI,
} from 'shared/ReactFeatureFlags';
import invariant from 'shared/invariant';
import shallowEqual from 'shared/shallowEqual';
import getComponentName from 'shared/getComponentName';
import ReactStrictModeWarnings from './ReactStrictModeWarnings';
import {refineResolvedLazyComponent} from 'shared/ReactLazyComponent';
import {REACT_LAZY_TYPE} from 'shared/ReactSymbols';
import warning from 'shared/warning';
import warningWithoutStack from 'shared/warningWithoutStack';
import {
  setCurrentPhase,
  getCurrentFiberOwnerNameInDevOrNull,
  getCurrentFiberStackInDev,
} from './ReactCurrentFiber';
import {startWorkTimer, cancelWorkTimer} from './ReactDebugFiberPerf';
import {
  resolveFunctionForHotReloading,
  resolveForwardRefForHotReloading,
  resolveClassForHotReloading,
} from './ReactFiberHotReloading';

import {
  mountChildFibers,
  reconcileChildFibers,
  cloneChildFibers,
} from './ReactChildFiber';
import {processUpdateQueue} from './ReactUpdateQueue';
import {
  NoWork,
  Never,
  computeAsyncExpiration,
} from './ReactFiberExpirationTime';
import {
  ConcurrentMode,
  NoMode,
  ProfileMode,
  StrictMode,
  BatchedMode,
} from './ReactTypeOfMode';
import {
  shouldSetTextContent,
  shouldDeprioritizeSubtree,
  isSuspenseInstancePending,
  isSuspenseInstanceFallback,
  registerSuspenseInstanceRetry,
} from './ReactFiberHostConfig';
import type {SuspenseInstance} from './ReactFiberHostConfig';
import {shouldSuspend} from './ReactFiberReconciler';
import {
  pushHostContext,
  pushHostContainer,
  pushHostContextForEventComponent,
} from './ReactFiberHostContext';
import {
  suspenseStackCursor,
  pushSuspenseContext,
  popSuspenseContext,
  InvisibleParentSuspenseContext,
  ForceSuspenseFallback,
  hasSuspenseContext,
  setDefaultShallowSuspenseContext,
  addSubtreeSuspenseContext,
  setShallowSuspenseContext,
} from './ReactFiberSuspenseContext';
import {isShowingAnyFallbacks} from './ReactFiberSuspenseComponent';
import {
  pushProvider,
  propagateContextChange,
  readContext,
  prepareToReadContext,
  calculateChangedBits,
  scheduleWorkOnParentPath,
} from './ReactFiberNewContext';
import {resetHooks, renderWithHooks, bailoutHooks} from './ReactFiberHooks';
import {stopProfilerTimerIfRunning} from './ReactProfilerTimer';
import {
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged as hasLegacyContextChanged,
  pushContextProvider as pushLegacyContextProvider,
  isContextProvider as isLegacyContextProvider,
  pushTopLevelContextObject,
  invalidateContextProvider,
} from './ReactFiberContext';
import {
  enterHydrationState,
  reenterHydrationStateFromDehydratedSuspenseInstance,
  resetHydrationState,
  tryToClaimNextHydratableInstance,
} from './ReactFiberHydrationContext';
import {
  adoptClassInstance,
  applyDerivedStateFromProps,
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
} from './ReactFiberClassComponent';
import {
  readLazyComponentType,
  resolveDefaultProps,
} from './ReactFiberLazyComponent';
import {
  resolveLazyComponentTag,
  createFiberFromTypeAndProps,
  createFiberFromFragment,
  createWorkInProgress,
  isSimpleFunctionComponent,
} from './ReactFiber';
import {
  markSpawnedWork,
  requestCurrentTime,
  retryTimedOutBoundary,
} from './ReactFiberWorkLoop';
import {prepareToReadEventComponents} from './ReactFiberEvents';

const ReactCurrentOwner = ReactSharedInternals.ReactCurrentOwner;

let didReceiveUpdate: boolean = false;

let didWarnAboutBadClass;
let didWarnAboutModulePatternComponent;
let didWarnAboutContextTypeOnFunctionComponent;
let didWarnAboutGetDerivedStateOnFunctionComponent;
let didWarnAboutFunctionRefs;
export let didWarnAboutReassigningProps;
let didWarnAboutMaxDuration;
let didWarnAboutRevealOrder;
let didWarnAboutTailOptions;

if (__DEV__) {
  didWarnAboutBadClass = {};
  didWarnAboutModulePatternComponent = {};
  didWarnAboutContextTypeOnFunctionComponent = {};
  didWarnAboutGetDerivedStateOnFunctionComponent = {};
  didWarnAboutFunctionRefs = {};
  didWarnAboutReassigningProps = false;
  didWarnAboutMaxDuration = false;
  didWarnAboutRevealOrder = {};
  didWarnAboutTailOptions = {};
}

//1、根据 props.children 生成 Fiber 树
//2、判断Fiber 对象是否可以复用
//3、列表根据 key 优化

//将 ReactElement 变成 fiber对象，并更新，生成对应 DOM 的实例，并挂载到真正的 DOM 节点上
export function reconcileChildren(
  current: Fiber | null,
  workInProgress: Fiber,
  nextChildren: any,
  renderExpirationTime: ExpirationTime,
) {
  //第一次渲染
  if (current === null) {
    // If this is a fresh new component that hasn't been rendered yet, we
    // won't update its child set by applying minimal side-effects. Instead,
    // we will add them all to the child before it gets rendered. That means
    // we can optimize this reconciliation pass by not tracking side-effects.

    //因为是第一次渲染，所以不存在current.child，所以第二个参数传的 null
    //React第一次渲染的顺序是先父节点，再是子节点

    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderExpirationTime,
    );
  } else {
    // If the current child is the same as the work in progress, it means that
    // we haven't yet started any work on these children. Therefore, we use
    // the clone algorithm to create a copy of all the current children.

    // If we had any progressed work already, that is invalid at this point so
    // let's throw it out.
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      current.child,
      nextChildren,
      renderExpirationTime,
    );
  }
}
// 强制重新计算 children
function forceUnmountCurrentAndReconcile(
  current: Fiber,
  workInProgress: Fiber,
  nextChildren: any,
  renderExpirationTime: ExpirationTime,
) {
  // This function is fork of reconcileChildren. It's used in cases where we
  // want to reconcile without matching against the existing set. This has the
  // effect of all current children being unmounted; even if the type and key
  // are the same, the old child is unmounted and a new child is created.
  //
  // To do this, we're going to go through the reconcile algorithm twice. In
  // the first pass, we schedule a deletion for all the current children by
  // passing null.

  //关于reconcileChildFibers()的讲解，请看「React源码解析之FunctionComponent（上）」
  //https://juejin.im/post/5ddbe114e51d45231e010c75
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    current.child,
    //nextChildren 为 null 也就是删除内部的所有子节点
    //渲染出的是一个空的 classComponent
    null,
    renderExpirationTime,
  );
  // In the second pass, we mount the new children. The trick here is that we
  // pass null in place of where we usually pass the current child set. This has
  // the effect of remounting all children regardless of whether their their
  // identity matches.
  //再渲染一遍，此时老 props 为 null（对应上面的 nextChildren = null）
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    //workInProgress 为 null
    null,
    //这里的新 props 跟老 props（null）基本是没有共同属性的
    nextChildren,
    renderExpirationTime,
  );
}

//更新被React.forwardRef包裹的 FunctionComponent
function updateForwardRef(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderExpirationTime: ExpirationTime,
) {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens after the first render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  //删除了 dev 代码

  //Component:{
  //   $$typeof: REACT_FORWARD_REF_TYPE,
  //   render,
  // }

  //FunctionComponent
  const render = Component.render;
  // 开发层面上不允许FunctionComponent，但你打印 props 的话是有的，
  // 因为是 React 只允许内部通过 props 传进来 ref
  const ref = workInProgress.ref;

  // The rest is a fork of updateFunctionComponent
  let nextChildren;
  //context 相关的可跳过
  prepareToReadContext(workInProgress, renderExpirationTime);
  prepareToReadEventComponents(workInProgress);
  if (__DEV__) {
    //删除了 dev 代码
  } else {
    //渲染的过程中，对里面用到的 hook函数做一些操作
    //关于renderWithHooks的讲解，请看：https://www.jianshu.com/p/959498695e83

    //注意：在updateFunctionComponent()中传的参数不是 ref，
    //而是 context：nextChildren = renderWithHooks(
    //   current,
    //   workInProgress,
    //   Component,
    //   nextProps,
    //   传的是 context 而不是 ref
    //   context,
    //   renderExpirationTime,
    // );
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      ref,
      renderExpirationTime,
    );
    //renderWithHooks 内部通过let children = Component(props, refOrContext)来更新 ref 或 context
  }

  //如果 props 相同，并且 ref 也相同的话，就不需要更新
  if (current !== null && !didReceiveUpdate) {
    //跳过hooks更新
    //关于bailoutHooks的讲解，请看：https://www.jianshu.com/p/959498695e83
    bailoutHooks(current, workInProgress, renderExpirationTime);
    //跳过该节点及所有子节点的更新
    //关于bailoutOnAlreadyFinishedWork的讲解，请看：https://www.jianshu.com/p/06b18db8b5d4
    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  //将 ReactElement 变成 fiber对象，并更新，生成对应 DOM 的实例，并挂载到真正的 DOM 节点上
  //关于reconcileChildren的讲解，请看：https://www.jianshu.com/p/959498695e83
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function updateMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  updateExpirationTime,
  renderExpirationTime: ExpirationTime,
): null | Fiber {
  if (current === null) {
    let type = Component.type;
    if (
      isSimpleFunctionComponent(type) &&
      Component.compare === null &&
      // SimpleMemoComponent codepath doesn't resolve outer props either.
      Component.defaultProps === undefined
    ) {
      let resolvedType = type;
      if (__DEV__) {
        resolvedType = resolveFunctionForHotReloading(type);
      }
      // If this is a plain function component without default props,
      // and with only the default shallow comparison, we upgrade it
      // to a SimpleMemoComponent to allow fast path updates.
      workInProgress.tag = SimpleMemoComponent;
      workInProgress.type = resolvedType;
      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, type);
      }
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        resolvedType,
        nextProps,
        updateExpirationTime,
        renderExpirationTime,
      );
    }
    if (__DEV__) {
      const innerPropTypes = type.propTypes;
      if (innerPropTypes) {
        // Inner memo component props aren't currently validated in createElement.
        // We could move it there, but we'd still need this for lazy code path.
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentName(type),
          getCurrentFiberStackInDev,
        );
      }
    }
    let child = createFiberFromTypeAndProps(
      Component.type,
      null,
      nextProps,
      null,
      workInProgress.mode,
      renderExpirationTime,
    );
    child.ref = workInProgress.ref;
    child.return = workInProgress;
    workInProgress.child = child;
    return child;
  }
  if (__DEV__) {
    const type = Component.type;
    const innerPropTypes = type.propTypes;
    if (innerPropTypes) {
      // Inner memo component props aren't currently validated in createElement.
      // We could move it there, but we'd still need this for lazy code path.
      checkPropTypes(
        innerPropTypes,
        nextProps, // Resolved props
        'prop',
        getComponentName(type),
        getCurrentFiberStackInDev,
      );
    }
  }
  let currentChild = ((current.child: any): Fiber); // This is always exactly one child
  if (updateExpirationTime < renderExpirationTime) {
    // This will be the props with resolved defaultProps,
    // unlike current.memoizedProps which will be the unresolved ones.
    const prevProps = currentChild.memoizedProps;
    // Default to shallow comparison
    let compare = Component.compare;
    compare = compare !== null ? compare : shallowEqual;
    if (compare(prevProps, nextProps) && current.ref === workInProgress.ref) {
      return bailoutOnAlreadyFinishedWork(
        current,
        workInProgress,
        renderExpirationTime,
      );
    }
  }
  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  let newChild = createWorkInProgress(
    currentChild,
    nextProps,
    renderExpirationTime,
  );
  newChild.ref = workInProgress.ref;
  newChild.return = workInProgress;
  workInProgress.child = newChild;
  return newChild;
}

function updateSimpleMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  updateExpirationTime,
  renderExpirationTime: ExpirationTime,
): null | Fiber {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens when the inner render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      let outerMemoType = workInProgress.elementType;
      if (outerMemoType.$$typeof === REACT_LAZY_TYPE) {
        // We warn when you define propTypes on lazy()
        // so let's just skip over it to find memo() outer wrapper.
        // Inner props for memo are validated later.
        outerMemoType = refineResolvedLazyComponent(outerMemoType);
      }
      const outerPropTypes = outerMemoType && (outerMemoType: any).propTypes;
      if (outerPropTypes) {
        checkPropTypes(
          outerPropTypes,
          nextProps, // Resolved (SimpleMemoComponent has no defaultProps)
          'prop',
          getComponentName(outerMemoType),
          getCurrentFiberStackInDev,
        );
      }
      // Inner propTypes will be validated in the function component path.
    }
  }
  if (current !== null) {
    const prevProps = current.memoizedProps;
    if (
      shallowEqual(prevProps, nextProps) &&
      current.ref === workInProgress.ref &&
      // Prevent bailout if the implementation changed due to hot reload:
      (__DEV__ ? workInProgress.type === current.type : true)
    ) {
      didReceiveUpdate = false;
      if (updateExpirationTime < renderExpirationTime) {
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderExpirationTime,
        );
      }
    }
  }
  return updateFunctionComponent(
    current,
    workInProgress,
    Component,
    nextProps,
    renderExpirationTime,
  );
}

function updateFragment(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  const nextChildren = workInProgress.pendingProps;
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function updateMode(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  const nextChildren = workInProgress.pendingProps.children;
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

function updateProfiler(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  if (enableProfilerTimer) {
    workInProgress.effectTag |= Update;
  }
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}
//标记 ref
function markRef(current: Fiber | null, workInProgress: Fiber) {
  const ref = workInProgress.ref;
  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    // Schedule a Ref effect
    workInProgress.effectTag |= Ref;
  }
}

//更新 functionComponent
//current：workInProgress.alternate
//Component：workInProgress.type
//resolvedProps：workInProgress.pendingProps
function updateFunctionComponent(
  current,
  workInProgress,
  Component,
  nextProps: any,
  renderExpirationTime,
) {
  //删掉了 dev 代码
  //后面讲 context 的时候再作说明
  const unmaskedContext = getUnmaskedContext(workInProgress, Component, true);
  const context = getMaskedContext(workInProgress, unmaskedContext);

  let nextChildren;
  //做update 标记可不看
  prepareToReadContext(workInProgress, renderExpirationTime);
  prepareToReadEventComponents(workInProgress);
  //删掉了 dev 代码

  //在渲染的过程中，对里面用到的 hooks 函数做一些操作
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      Component,
      nextProps,
      context,
      renderExpirationTime,
    );

  //如果不是第一次渲染，并且没有接收到更新的话
  //didReceiveUpdate:更新上的优化
  if (current !== null && !didReceiveUpdate) {
  }
  //跳过hooks更新
  bailoutHooks(current, workInProgress, renderExpirationTime);
    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  // React DevTools reads this flag.
  //表明当前组件在渲染的过程中有被更新到
  workInProgress.effectTag |= PerformedWork;
  //将 ReactElement 变成 fiber对象，并更新，生成对应 DOM 的实例，并挂载到真正的 DOM 节点上
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}
//更新ClassComponent
function updateClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps,
  renderExpirationTime: ExpirationTime,
) {
  //删除了 dev 代码
  //=============context 相关代码，可跳过=========================================================
  // Push context providers early to prevent context stack mismatches.
  // During mounting we don't know the child context yet as the instance doesn't exist.
  // We will invalidate the child context in finishClassComponent() right after rendering.
  let hasContext;
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }
  prepareToReadContext(workInProgress, renderExpirationTime);
  //=====================================================================
  // 此处的stateNode指的是ClassComponent对应的Class实例。
  // FunctionComponent没有实例，所以stateNode值为null
  const instance = workInProgress.stateNode;
  let shouldUpdate;
  //当未创建实例的时候
  if (instance === null) {
    //current和workInProgress是doubleBuffer的关系，
    //React会先创建workInProgress，在渲染结束后，会把workInProgress复制给 current，此时渲染结束

    //渲染了但是没有实例的情况，比如报错时
    if (current !== null) {
      // An class component without an instance only mounts if it suspended
      // inside a non- concurrent tree, in an inconsistent state. We want to
      // tree it like a new mount, even though an empty version of it already
      // committed. Disconnect the alternate pointers.
      current.alternate = null;
      workInProgress.alternate = null;
      // Since this is conceptually a new fiber, schedule a Placement effect
      workInProgress.effectTag |= Placement;
    }
    // In the initial pass we might need to construct the instance.
    //构建 class 实例
    constructClassInstance(
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
    //在未render的 class 实例上调用挂载生命周期
    mountClassInstance(
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
    shouldUpdate = true;
  }
  //第一次渲染
  else if (current === null) {
    // In a resume, we'll already have an instance we can reuse.
    //此时 instance 已经创建，复用 class 实例，更新 props/state，
    // 调用生命周期（componentWillMount,componentDidMount），返回 shouldUpdate
    shouldUpdate = resumeMountClassInstance(
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
  }
  //instance!==null&&current!==null
  //当已经创建实例并且不是第一次渲染的话，调用更新的生命周期方法为componentWillUpdate,componentDidUpdate()
  else {
    shouldUpdate = updateClassInstance(
      current,
      workInProgress,
      Component,
      nextProps,
      renderExpirationTime,
    );
  }
  //判断是否执行 render，并返回 render 下的第一个 child
  const nextUnitOfWork = finishClassComponent(
    current,
    workInProgress,
    Component,
    shouldUpdate,
    hasContext,
    renderExpirationTime,
  );
  //删除了 dev 代码


  return nextUnitOfWork;
}
//判断是否执行 render，并返回 render 下的第一个 child
function finishClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  shouldUpdate: boolean,
  hasContext: boolean,
  renderExpirationTime: ExpirationTime,
) {
  // Refs should update even if shouldComponentUpdate returns false
  //无论是否更新 props/state，都必须更新 ref 指向
  markRef(current, workInProgress);
  //判断是否有错误捕获
  const didCaptureError = (workInProgress.effectTag & DidCapture) !== NoEffect;
  //当不需要更新/更新完毕，并且没有出现 error 的时候
  if (!shouldUpdate && !didCaptureError) {
    // Context providers should defer to sCU for rendering
    if (hasContext) {
      invalidateContextProvider(workInProgress, Component, false);
    }
    //跳过该class 上的节点及所有子节点的更新,即跳过调用 render 方法
    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  const instance = workInProgress.stateNode;

  // Rerender
  ReactCurrentOwner.current = workInProgress;
  let nextChildren;
  //getDerivedStateFromError是生命周期api，作用是捕获 render error，详情请看：
  //https://zh-hans.reactjs.org/docs/react-component.html#static-getderivedstatefromerror
  if (
    didCaptureError &&
    typeof Component.getDerivedStateFromError !== 'function'
  ) {
    // If we captured an error, but getDerivedStateFrom catch is not defined,
    // unmount all the children. componentDidCatch will schedule an update to
    // re-render a fallback. This is temporary until we migrate everyone to
    // the new API.
    // TODO: Warn in a future release.
    //如果出现 error 但是开发者没有调用getDerivedStateFromError的话，就中断渲染
    nextChildren = null;

    if (enableProfilerTimer) {
      stopProfilerTimerIfRunning(workInProgress);
    }
  }
  //否则重新渲染
  else {
    //删除了 dev 代码
    if (__DEV__) {

    } else {
      nextChildren = instance.render();
    }
  }

  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  //当 classComponent 内部的节点报错时
  if (current !== null && didCaptureError) {
    // If we're recovering from an error, reconcile without reusing any of
    // the existing children. Conceptually, the normal children and the children
    // that are shown on error are two different sets, so we shouldn't reuse
    // normal children even if their identities match.
    //强制重新计算 children，因为当出错时，是渲染到节点上的 props/state 出现了问题，所以不能复用，必须重新 render
    forceUnmountCurrentAndReconcile(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
  } else {
    // 将 ReactElement 变成fiber对象，并更新，生成对应 DOM 的实例，并挂载到真正的 DOM 节点上
    reconcileChildren(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
  }

  // Memoize state using the values we just used to render.
  // TODO: Restructure so we never read values from the instance.
  workInProgress.memoizedState = instance.state;

  // The context might have changed so we need to recalculate it.
  if (hasContext) {
    invalidateContextProvider(workInProgress, Component, true);
  }
  //返回 render 下的第一个节点
  return workInProgress.child;
}

function pushHostRootContext(workInProgress) {
  const root = (workInProgress.stateNode: FiberRoot);
  if (root.pendingContext) {
    pushTopLevelContextObject(
      workInProgress,
      root.pendingContext,
      root.pendingContext !== root.context,
    );
  } else if (root.context) {
    // Should always be set
    pushTopLevelContextObject(workInProgress, root.context, false);
  }
  pushHostContainer(workInProgress, root.containerInfo);
}

//更新 HostRoot 组件
function updateHostRoot(current, workInProgress, renderExpirationTime) {
  //=======context相关的可跳过===================================
  pushHostRootContext(workInProgress);
  //===========================================================
  const updateQueue = workInProgress.updateQueue;
  //报错，没有更新队列的话应该跳出，意思就是没有跳出，仍然执行updateHostRoot方法
  invariant(
    updateQueue !== null,
    'If the root does not have an updateQueue, we should have already ' +
      'bailed out. This error is likely caused by a bug in React. Please ' +
      'file an issue.',
  );

  const nextProps = workInProgress.pendingProps;
  const prevState = workInProgress.memoizedState;
  //要更新的 ReactElement 节点，包括其子树
  const prevChildren = prevState !== null ? prevState.element : null;
  //更新 update 队列，并更新 state
  processUpdateQueue(
    workInProgress,
    updateQueue,
    nextProps,
    null,
    renderExpirationTime,
  );
  const nextState = workInProgress.memoizedState;
  // Caution: React DevTools currently depends on this property
  // being called "element".
  const nextChildren = nextState.element;

  //state 相同，则跳过更新
  if (nextChildren === prevChildren) {
    // If the state is the same as before, that's a bailout because we had
    // no work that expires at this time.
    resetHydrationState();
    return bailoutOnAlreadyFinishedWork(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }

  const root: FiberRoot = workInProgress.stateNode;

  //如果是第一次渲染的话
  if (
    (current === null || current.child === null) &&
    root.hydrate &&
    enterHydrationState(workInProgress)
  ) {
    // If we don't have any current children this might be the first pass.
    // We always try to hydrate. If this isn't a hydration pass there won't
    // be any children to hydrate which is effectively the same thing as
    // not hydrating.

    // This is a bit of a hack. We track the host root as a placement to
    // know that we're currently in a mounting state. That way isMounted
    // works as expected. We must reset this before committing.
    // TODO: Delete this when we delete isMounted and findDOMNode.
    workInProgress.effectTag |= Placement;

    // Ensure that children mount into this root without tracking
    // side-effects. This ensures that we don't store Placement effects on
    // nodes that will be hydrated.
    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderExpirationTime,
    );
  }
  //不是第一次渲染的话
  else {
    // Otherwise reset hydration state in case we aborted and resumed another
    // root.
    reconcileChildren(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
    resetHydrationState();
  }
  return workInProgress.child;
}

//更新 DOM 标签
function updateHostComponent(current, workInProgress, renderExpirationTime) {
  //===暂时跳过 context
  pushHostContext(workInProgress);
  //判断能否复用服务端渲染的节点
  if (current === null) {
    tryToClaimNextHydratableInstance(workInProgress);
  }

  const type = workInProgress.type;
  const nextProps = workInProgress.pendingProps;
  const prevProps = current !== null ? current.memoizedProps : null;

  let nextChildren = nextProps.children;
  //判断该节点是否是文本节点
  const isDirectTextChild = shouldSetTextContent(type, nextProps);
  //如果是文本节点的话（即里面不再嵌套其他类型的节点）
  if (isDirectTextChild) {
    // We special case a direct text child of a host node. This is a common
    // case. We won't handle it as a reified child. We will instead handle
    // this in the host environment that also have access to this prop. That
    // avoids allocating another HostText fiber and traversing it.
    //不必渲染子节点，直接显示其文本即可
    nextChildren = null;
  }
  //如果之前节点不为空且为文本节点，但现在更新为其他类型的节点的话
  else if (prevProps !== null && shouldSetTextContent(type, prevProps)) {
    // If we're switching from a direct text child to a normal child, or to
    // empty, we need to schedule the text content to be reset.
    //重置文本节点
    workInProgress.effectTag |= ContentReset;
  }
  //只有 HostComponent 和 ClassComponent 有使用该方法
  //因为只有这两个 Component 能拿到 DOM 实例
  markRef(current, workInProgress);

  // Check the host config to see if the children are offscreen/hidden.
  //如果该节点上设置了 hidden 属性，并且是异步渲染(ConcurrentMode)的话，那么它将最后更新

  //关于 ConcurrentMode 模式，请参考：https://zh-hans.reactjs.org/docs/concurrent-mode-intro.html
  if (
    workInProgress.mode & ConcurrentMode &&
    renderExpirationTime !== Never &&
    shouldDeprioritizeSubtree(type, nextProps)
  ) {
    if (enableSchedulerTracing) {
      markSpawnedWork(Never);
    }
    // Schedule this fiber to re-render at offscreen priority. Then bailout.
    //优先级最低，即最后更新
    workInProgress.expirationTime = workInProgress.childExpirationTime = Never;
    return null;
  }
  //将 ReactElement 变成 fiber对象，并更新，生成对应 DOM 的实例，并挂载到真正的 DOM 节点上
  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  return workInProgress.child;
}

//更新 host 文本节点
function updateHostText(current, workInProgress) {
  if (current === null) {
    tryToClaimNextHydratableInstance(workInProgress);
  }
  // Nothing to do here. This is terminal. We'll do the completion step
  // immediately after.
  //没有对 DOM 进行操作的地方，直接渲染出来即可
  return null;
}

function mountLazyComponent(
  _current,
  workInProgress,
  elementType,
  updateExpirationTime,
  renderExpirationTime,
) {
  if (_current !== null) {
    // An lazy component only mounts if it suspended inside a non-
    // concurrent tree, in an inconsistent state. We want to treat it like
    // a new mount, even though an empty version of it already committed.
    // Disconnect the alternate pointers.
    _current.alternate = null;
    workInProgress.alternate = null;
    // Since this is conceptually a new fiber, schedule a Placement effect
    workInProgress.effectTag |= Placement;
  }

  const props = workInProgress.pendingProps;
  // We can't start a User Timing measurement with correct label yet.
  // Cancel and resume right after we know the tag.
  cancelWorkTimer(workInProgress);
  let Component = readLazyComponentType(elementType);
  // Store the unwrapped component in the type.
  workInProgress.type = Component;
  const resolvedTag = (workInProgress.tag = resolveLazyComponentTag(Component));
  startWorkTimer(workInProgress);
  const resolvedProps = resolveDefaultProps(Component, props);
  let child;
  switch (resolvedTag) {
    case FunctionComponent: {
      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, Component);
        workInProgress.type = Component = resolveFunctionForHotReloading(
          Component,
        );
      }
      child = updateFunctionComponent(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
      break;
    }
    case ClassComponent: {
      if (__DEV__) {
        workInProgress.type = Component = resolveClassForHotReloading(
          Component,
        );
      }
      child = updateClassComponent(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
      break;
    }
    case ForwardRef: {
      if (__DEV__) {
        workInProgress.type = Component = resolveForwardRefForHotReloading(
          Component,
        );
      }
      child = updateForwardRef(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
      break;
    }
    case MemoComponent: {
      if (__DEV__) {
        if (workInProgress.type !== workInProgress.elementType) {
          const outerPropTypes = Component.propTypes;
          if (outerPropTypes) {
            checkPropTypes(
              outerPropTypes,
              resolvedProps, // Resolved for outer only
              'prop',
              getComponentName(Component),
              getCurrentFiberStackInDev,
            );
          }
        }
      }
      child = updateMemoComponent(
        null,
        workInProgress,
        Component,
        resolveDefaultProps(Component.type, resolvedProps), // The inner type can have defaults too
        updateExpirationTime,
        renderExpirationTime,
      );
      break;
    }
    default: {
      let hint = '';
      if (__DEV__) {
        if (
          Component !== null &&
          typeof Component === 'object' &&
          Component.$$typeof === REACT_LAZY_TYPE
        ) {
          hint = ' Did you wrap a component in React.lazy() more than once?';
        }
      }
      // This message intentionally doesn't mention ForwardRef or MemoComponent
      // because the fact that it's a separate type of work is an
      // implementation detail.
      invariant(
        false,
        'Element type is invalid. Received a promise that resolves to: %s. ' +
          'Lazy element type must resolve to a class or function.%s',
        Component,
        hint,
      );
    }
  }
  return child;
}

function mountIncompleteClassComponent(
  _current,
  workInProgress,
  Component,
  nextProps,
  renderExpirationTime,
) {
  if (_current !== null) {
    // An incomplete component only mounts if it suspended inside a non-
    // concurrent tree, in an inconsistent state. We want to treat it like
    // a new mount, even though an empty version of it already committed.
    // Disconnect the alternate pointers.
    _current.alternate = null;
    workInProgress.alternate = null;
    // Since this is conceptually a new fiber, schedule a Placement effect
    workInProgress.effectTag |= Placement;
  }

  // Promote the fiber to a class and try rendering again.
  workInProgress.tag = ClassComponent;

  // The rest of this function is a fork of `updateClassComponent`

  // Push context providers early to prevent context stack mismatches.
  // During mounting we don't know the child context yet as the instance doesn't exist.
  // We will invalidate the child context in finishClassComponent() right after rendering.
  let hasContext;
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }
  prepareToReadContext(workInProgress, renderExpirationTime);

  constructClassInstance(
    workInProgress,
    Component,
    nextProps,
    renderExpirationTime,
  );
  mountClassInstance(
    workInProgress,
    Component,
    nextProps,
    renderExpirationTime,
  );

  return finishClassComponent(
    null,
    workInProgress,
    Component,
    true,
    hasContext,
    renderExpirationTime,
  );
}
//进一步明确 FunctionComponent 以何种方式更新
function mountIndeterminateComponent(
  _current,
  workInProgress,
  Component,
  renderExpirationTime,
) {
  //只有在第一次渲染的时候，才会调用mountIndeterminateComponent()，此时_current应该为 null
  //出现_current不为 null 的情况，一般是第一次渲染的时候捕获到 error 了，此时就需要重置_current和workInProgress
  if (_current !== null) {
    // An indeterminate component only mounts if it suspended inside a non-
    // concurrent tree, in an inconsistent state. We want to treat it like
    // a new mount, even though an empty version of it already committed.
    // Disconnect the alternate pointers.
    _current.alternate = null;
    workInProgress.alternate = null;
    // Since this is conceptually a new fiber, schedule a Placement effect
    workInProgress.effectTag |= Placement;
  }

  const props = workInProgress.pendingProps;
  //=========context 可跳过===========================================================
  const unmaskedContext = getUnmaskedContext(workInProgress, Component, false);
  const context = getMaskedContext(workInProgress, unmaskedContext);

  prepareToReadContext(workInProgress, renderExpirationTime);
  prepareToReadEventComponents(workInProgress);
  //=======================================================================

  let value;

  if (__DEV__) {
    //删除了 dev 代码
  } else {
    //因为FunctionComponent一开始是处于indeterminateComponent的状态下的，所以会涉及到 hooks
    //渲染的过程中，对里面用到的 hook函数做一些操作

    //renderWithHooks的解析请看 React源码解析之FunctionComponent（上）：
    //https://juejin.im/post/5ddbe114e51d45231e010c75
    value = renderWithHooks(
      null,
      workInProgress,
      Component,
      props,
      context,
      renderExpirationTime,
    );
  }
  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;

  //确认是否是 ClassComponent，因为只有ClassComponent有 render() 方法

  //关键是这个判断条件
  //如果这个条件成立的话，就表明可以在 FunctionComponent 中使用 ClassComponent 的 API ！!
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof value.render === 'function' &&
    value.$$typeof === undefined
  ) {
    //删除了 dev 代码

    // Proceed under the assumption that this is a class instance
    workInProgress.tag = ClassComponent;

    // Throw out any hooks that were used.
    // 重置 hooks 状态，也就是不使用 hooks
    resetHooks();

    // Push context providers early to prevent context stack mismatches.
    // During mounting we don't know the child context yet as the instance doesn't exist.
    // We will invalidate the child context in finishClassComponent() right after rendering.

    //下面的这些 function 在 updateClassComponent() 中都有解析过，就不再赘述了
    //https://juejin.im/post/5e1bc74ee51d45020837e8f4
    let hasContext = false;
    if (isLegacyContextProvider(Component)) {
      hasContext = true;
      pushLegacyContextProvider(workInProgress);
    } else {
      hasContext = false;
    }

    workInProgress.memoizedState =
      value.state !== null && value.state !== undefined ? value.state : null;

    const getDerivedStateFromProps = Component.getDerivedStateFromProps;
    if (typeof getDerivedStateFromProps === 'function') {
      applyDerivedStateFromProps(
        workInProgress,
        Component,
        getDerivedStateFromProps,
        props,
      );
    }

    adoptClassInstance(workInProgress, value);
    mountClassInstance(workInProgress, Component, props, renderExpirationTime);
    return finishClassComponent(
      null,
      workInProgress,
      Component,
      true,
      hasContext,
      renderExpirationTime,
    );
  }
  //否则就是 FunctionComponent
  else {
    // Proceed under the assumption that this is a function component
    //正式赋予 tag 为 FunctionComponent，将按照FunctionComponent的流程更新组件
    workInProgress.tag = FunctionComponent;
    //删除了 dev 代码
    //reconcileChildren的解析请看：React源码解析之FunctionComponent（上）
    //https://juejin.im/post/5ddbe114e51d45231e010c75
    reconcileChildren(null, workInProgress, value, renderExpirationTime);
    if (__DEV__) {
      validateFunctionComponentInDev(workInProgress, Component);
    }
    return workInProgress.child;
  }
}

function validateFunctionComponentInDev(workInProgress: Fiber, Component: any) {
  if (Component) {
    warningWithoutStack(
      !Component.childContextTypes,
      '%s(...): childContextTypes cannot be defined on a function component.',
      Component.displayName || Component.name || 'Component',
    );
  }
  if (workInProgress.ref !== null) {
    let info = '';
    const ownerName = getCurrentFiberOwnerNameInDevOrNull();
    if (ownerName) {
      info += '\n\nCheck the render method of `' + ownerName + '`.';
    }

    let warningKey = ownerName || workInProgress._debugID || '';
    const debugSource = workInProgress._debugSource;
    if (debugSource) {
      warningKey = debugSource.fileName + ':' + debugSource.lineNumber;
    }
    if (!didWarnAboutFunctionRefs[warningKey]) {
      didWarnAboutFunctionRefs[warningKey] = true;
      warning(
        false,
        'Function components cannot be given refs. ' +
          'Attempts to access this ref will fail. ' +
          'Did you mean to use React.forwardRef()?%s',
        info,
      );
    }
  }

  if (typeof Component.getDerivedStateFromProps === 'function') {
    const componentName = getComponentName(Component) || 'Unknown';

    if (!didWarnAboutGetDerivedStateOnFunctionComponent[componentName]) {
      warningWithoutStack(
        false,
        '%s: Function components do not support getDerivedStateFromProps.',
        componentName,
      );
      didWarnAboutGetDerivedStateOnFunctionComponent[componentName] = true;
    }
  }

  if (
    typeof Component.contextType === 'object' &&
    Component.contextType !== null
  ) {
    const componentName = getComponentName(Component) || 'Unknown';

    if (!didWarnAboutContextTypeOnFunctionComponent[componentName]) {
      warningWithoutStack(
        false,
        '%s: Function components do not support contextType.',
        componentName,
      );
      didWarnAboutContextTypeOnFunctionComponent[componentName] = true;
    }
  }
}

// TODO: This is now an empty object. Should we just make it a boolean?
const SUSPENDED_MARKER: SuspenseState = ({}: any);

function shouldRemainOnFallback(
  suspenseContext: SuspenseContext,
  current: null | Fiber,
  workInProgress: Fiber,
) {
  // If the context is telling us that we should show a fallback, and we're not
  // already showing content, then we should show the fallback instead.
  return (
    hasSuspenseContext(
      suspenseContext,
      (ForceSuspenseFallback: SuspenseContext),
    ) &&
    (current === null || current.memoizedState !== null)
  );
}

function updateSuspenseComponent(
  current,
  workInProgress,
  renderExpirationTime,
) {
  const mode = workInProgress.mode;
  const nextProps = workInProgress.pendingProps;

  // This is used by DevTools to force a boundary to suspend.
  if (__DEV__) {
    if (shouldSuspend(workInProgress)) {
      workInProgress.effectTag |= DidCapture;
    }
  }

  let suspenseContext: SuspenseContext = suspenseStackCursor.current;

  let nextState = null;
  let nextDidTimeout = false;

  if (
    (workInProgress.effectTag & DidCapture) !== NoEffect ||
    shouldRemainOnFallback(suspenseContext, current, workInProgress)
  ) {
    // Something in this boundary's subtree already suspended. Switch to
    // rendering the fallback children.
    nextState = SUSPENDED_MARKER;
    nextDidTimeout = true;
    workInProgress.effectTag &= ~DidCapture;
  } else {
    // Attempting the main content
    if (current === null || current.memoizedState !== null) {
      // This is a new mount or this boundary is already showing a fallback state.
      // Mark this subtree context as having at least one invisible parent that could
      // handle the fallback state.
      // Boundaries without fallbacks or should be avoided are not considered since
      // they cannot handle preferred fallback states.
      if (
        nextProps.fallback !== undefined &&
        nextProps.unstable_avoidThisFallback !== true
      ) {
        suspenseContext = addSubtreeSuspenseContext(
          suspenseContext,
          InvisibleParentSuspenseContext,
        );
      }
    }
  }

  suspenseContext = setDefaultShallowSuspenseContext(suspenseContext);

  pushSuspenseContext(workInProgress, suspenseContext);

  if (__DEV__) {
    if ('maxDuration' in nextProps) {
      if (!didWarnAboutMaxDuration) {
        didWarnAboutMaxDuration = true;
        warning(
          false,
          'maxDuration has been removed from React. ' +
            'Remove the maxDuration prop.',
        );
      }
    }
  }

  // This next part is a bit confusing. If the children timeout, we switch to
  // showing the fallback children in place of the "primary" children.
  // However, we don't want to delete the primary children because then their
  // state will be lost (both the React state and the host state, e.g.
  // uncontrolled form inputs). Instead we keep them mounted and hide them.
  // Both the fallback children AND the primary children are rendered at the
  // same time. Once the primary children are un-suspended, we can delete
  // the fallback children — don't need to preserve their state.
  //
  // The two sets of children are siblings in the host environment, but
  // semantically, for purposes of reconciliation, they are two separate sets.
  // So we store them using two fragment fibers.
  //
  // However, we want to avoid allocating extra fibers for every placeholder.
  // They're only necessary when the children time out, because that's the
  // only time when both sets are mounted.
  //
  // So, the extra fragment fibers are only used if the children time out.
  // Otherwise, we render the primary children directly. This requires some
  // custom reconciliation logic to preserve the state of the primary
  // children. It's essentially a very basic form of re-parenting.

  // `child` points to the child fiber. In the normal case, this is the first
  // fiber of the primary children set. In the timed-out case, it's a
  // a fragment fiber containing the primary children.
  let child;
  // `next` points to the next fiber React should render. In the normal case,
  // it's the same as `child`: the first fiber of the primary children set.
  // In the timed-out case, it's a fragment fiber containing the *fallback*
  // children -- we skip over the primary children entirely.
  let next;
  if (current === null) {
    if (enableSuspenseServerRenderer) {
      // If we're currently hydrating, try to hydrate this boundary.
      // But only if this has a fallback.
      if (nextProps.fallback !== undefined) {
        tryToClaimNextHydratableInstance(workInProgress);
        // This could've changed the tag if this was a dehydrated suspense component.
        if (workInProgress.tag === DehydratedSuspenseComponent) {
          popSuspenseContext(workInProgress);
          return updateDehydratedSuspenseComponent(
            null,
            workInProgress,
            renderExpirationTime,
          );
        }
      }
    }

    // This is the initial mount. This branch is pretty simple because there's
    // no previous state that needs to be preserved.
    if (nextDidTimeout) {
      // Mount separate fragments for primary and fallback children.
      const nextFallbackChildren = nextProps.fallback;
      const primaryChildFragment = createFiberFromFragment(
        null,
        mode,
        NoWork,
        null,
      );
      primaryChildFragment.return = workInProgress;

      if ((workInProgress.mode & BatchedMode) === NoMode) {
        // Outside of batched mode, we commit the effects from the
        // partially completed, timed-out tree, too.
        const progressedState: SuspenseState = workInProgress.memoizedState;
        const progressedPrimaryChild: Fiber | null =
          progressedState !== null
            ? (workInProgress.child: any).child
            : (workInProgress.child: any);
        primaryChildFragment.child = progressedPrimaryChild;
        let progressedChild = progressedPrimaryChild;
        while (progressedChild !== null) {
          progressedChild.return = primaryChildFragment;
          progressedChild = progressedChild.sibling;
        }
      }

      const fallbackChildFragment = createFiberFromFragment(
        nextFallbackChildren,
        mode,
        renderExpirationTime,
        null,
      );
      fallbackChildFragment.return = workInProgress;
      primaryChildFragment.sibling = fallbackChildFragment;
      child = primaryChildFragment;
      // Skip the primary children, and continue working on the
      // fallback children.
      next = fallbackChildFragment;
    } else {
      // Mount the primary children without an intermediate fragment fiber.
      const nextPrimaryChildren = nextProps.children;
      child = next = mountChildFibers(
        workInProgress,
        null,
        nextPrimaryChildren,
        renderExpirationTime,
      );
    }
  } else {
    // This is an update. This branch is more complicated because we need to
    // ensure the state of the primary children is preserved.
    const prevState = current.memoizedState;
    const prevDidTimeout = prevState !== null;
    if (prevDidTimeout) {
      // The current tree already timed out. That means each child set is
      // wrapped in a fragment fiber.
      const currentPrimaryChildFragment: Fiber = (current.child: any);
      const currentFallbackChildFragment: Fiber = (currentPrimaryChildFragment.sibling: any);
      if (nextDidTimeout) {
        // Still timed out. Reuse the current primary children by cloning
        // its fragment. We're going to skip over these entirely.
        const nextFallbackChildren = nextProps.fallback;
        const primaryChildFragment = createWorkInProgress(
          currentPrimaryChildFragment,
          currentPrimaryChildFragment.pendingProps,
          NoWork,
        );
        primaryChildFragment.return = workInProgress;

        if ((workInProgress.mode & BatchedMode) === NoMode) {
          // Outside of batched mode, we commit the effects from the
          // partially completed, timed-out tree, too.
          const progressedState: SuspenseState = workInProgress.memoizedState;
          const progressedPrimaryChild: Fiber | null =
            progressedState !== null
              ? (workInProgress.child: any).child
              : (workInProgress.child: any);
          if (progressedPrimaryChild !== currentPrimaryChildFragment.child) {
            primaryChildFragment.child = progressedPrimaryChild;
            let progressedChild = progressedPrimaryChild;
            while (progressedChild !== null) {
              progressedChild.return = primaryChildFragment;
              progressedChild = progressedChild.sibling;
            }
          }
        }

        // Because primaryChildFragment is a new fiber that we're inserting as the
        // parent of a new tree, we need to set its treeBaseDuration.
        if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
          // treeBaseDuration is the sum of all the child tree base durations.
          let treeBaseDuration = 0;
          let hiddenChild = primaryChildFragment.child;
          while (hiddenChild !== null) {
            treeBaseDuration += hiddenChild.treeBaseDuration;
            hiddenChild = hiddenChild.sibling;
          }
          primaryChildFragment.treeBaseDuration = treeBaseDuration;
        }

        // Clone the fallback child fragment, too. These we'll continue
        // working on.
        const fallbackChildFragment = createWorkInProgress(
          currentFallbackChildFragment,
          nextFallbackChildren,
          currentFallbackChildFragment.expirationTime,
        );
        fallbackChildFragment.return = workInProgress;
        primaryChildFragment.sibling = fallbackChildFragment;
        child = primaryChildFragment;
        primaryChildFragment.childExpirationTime = NoWork;
        // Skip the primary children, and continue working on the
        // fallback children.
        next = fallbackChildFragment;
      } else {
        // No longer suspended. Switch back to showing the primary children,
        // and remove the intermediate fragment fiber.
        const nextPrimaryChildren = nextProps.children;
        const currentPrimaryChild = currentPrimaryChildFragment.child;
        const primaryChild = reconcileChildFibers(
          workInProgress,
          currentPrimaryChild,
          nextPrimaryChildren,
          renderExpirationTime,
        );

        // If this render doesn't suspend, we need to delete the fallback
        // children. Wait until the complete phase, after we've confirmed the
        // fallback is no longer needed.
        // TODO: Would it be better to store the fallback fragment on
        // the stateNode?

        // Continue rendering the children, like we normally do.
        child = next = primaryChild;
      }
    } else {
      // The current tree has not already timed out. That means the primary
      // children are not wrapped in a fragment fiber.
      const currentPrimaryChild = current.child;
      if (nextDidTimeout) {
        // Timed out. Wrap the children in a fragment fiber to keep them
        // separate from the fallback children.
        const nextFallbackChildren = nextProps.fallback;
        const primaryChildFragment = createFiberFromFragment(
          // It shouldn't matter what the pending props are because we aren't
          // going to render this fragment.
          null,
          mode,
          NoWork,
          null,
        );
        primaryChildFragment.return = workInProgress;
        primaryChildFragment.child = currentPrimaryChild;
        if (currentPrimaryChild !== null) {
          currentPrimaryChild.return = primaryChildFragment;
        }

        // Even though we're creating a new fiber, there are no new children,
        // because we're reusing an already mounted tree. So we don't need to
        // schedule a placement.
        // primaryChildFragment.effectTag |= Placement;

        if ((workInProgress.mode & BatchedMode) === NoMode) {
          // Outside of batched mode, we commit the effects from the
          // partially completed, timed-out tree, too.
          const progressedState: SuspenseState = workInProgress.memoizedState;
          const progressedPrimaryChild: Fiber | null =
            progressedState !== null
              ? (workInProgress.child: any).child
              : (workInProgress.child: any);
          primaryChildFragment.child = progressedPrimaryChild;
          let progressedChild = progressedPrimaryChild;
          while (progressedChild !== null) {
            progressedChild.return = primaryChildFragment;
            progressedChild = progressedChild.sibling;
          }
        }

        // Because primaryChildFragment is a new fiber that we're inserting as the
        // parent of a new tree, we need to set its treeBaseDuration.
        if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
          // treeBaseDuration is the sum of all the child tree base durations.
          let treeBaseDuration = 0;
          let hiddenChild = primaryChildFragment.child;
          while (hiddenChild !== null) {
            treeBaseDuration += hiddenChild.treeBaseDuration;
            hiddenChild = hiddenChild.sibling;
          }
          primaryChildFragment.treeBaseDuration = treeBaseDuration;
        }

        // Create a fragment from the fallback children, too.
        const fallbackChildFragment = createFiberFromFragment(
          nextFallbackChildren,
          mode,
          renderExpirationTime,
          null,
        );
        fallbackChildFragment.return = workInProgress;
        primaryChildFragment.sibling = fallbackChildFragment;
        fallbackChildFragment.effectTag |= Placement;
        child = primaryChildFragment;
        primaryChildFragment.childExpirationTime = NoWork;
        // Skip the primary children, and continue working on the
        // fallback children.
        next = fallbackChildFragment;
      } else {
        // Still haven't timed out.  Continue rendering the children, like we
        // normally do.
        const nextPrimaryChildren = nextProps.children;
        next = child = reconcileChildFibers(
          workInProgress,
          currentPrimaryChild,
          nextPrimaryChildren,
          renderExpirationTime,
        );
      }
    }
    workInProgress.stateNode = current.stateNode;
  }

  workInProgress.memoizedState = nextState;
  workInProgress.child = child;
  return next;
}

function retrySuspenseComponentWithoutHydrating(
  current: Fiber,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  // Detach from the current dehydrated boundary.
  current.alternate = null;
  workInProgress.alternate = null;

  // Insert a deletion in the effect list.
  let returnFiber = workInProgress.return;
  invariant(
    returnFiber !== null,
    'Suspense boundaries are never on the root. ' +
      'This is probably a bug in React.',
  );
  const last = returnFiber.lastEffect;
  if (last !== null) {
    last.nextEffect = current;
    returnFiber.lastEffect = current;
  } else {
    returnFiber.firstEffect = returnFiber.lastEffect = current;
  }
  current.nextEffect = null;
  current.effectTag = Deletion;

  popSuspenseContext(workInProgress);

  // Upgrade this work in progress to a real Suspense component.
  workInProgress.tag = SuspenseComponent;
  workInProgress.stateNode = null;
  workInProgress.memoizedState = null;
  // This is now an insertion.
  workInProgress.effectTag |= Placement;
  // Retry as a real Suspense component.
  return updateSuspenseComponent(null, workInProgress, renderExpirationTime);
}

function updateDehydratedSuspenseComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  pushSuspenseContext(
    workInProgress,
    setDefaultShallowSuspenseContext(suspenseStackCursor.current),
  );
  const suspenseInstance = (workInProgress.stateNode: SuspenseInstance);
  if (current === null) {
    // During the first pass, we'll bail out and not drill into the children.
    // Instead, we'll leave the content in place and try to hydrate it later.
    if (isSuspenseInstanceFallback(suspenseInstance)) {
      // This is a client-only boundary. Since we won't get any content from the server
      // for this, we need to schedule that at a higher priority based on when it would
      // have timed out. In theory we could render it in this pass but it would have the
      // wrong priority associated with it and will prevent hydration of parent path.
      // Instead, we'll leave work left on it to render it in a separate commit.

      // TODO This time should be the time at which the server rendered response that is
      // a parent to this boundary was displayed. However, since we currently don't have
      // a protocol to transfer that time, we'll just estimate it by using the current
      // time. This will mean that Suspense timeouts are slightly shifted to later than
      // they should be.
      let serverDisplayTime = requestCurrentTime();
      // Schedule a normal pri update to render this content.
      workInProgress.expirationTime = computeAsyncExpiration(serverDisplayTime);
    } else {
      // We'll continue hydrating the rest at offscreen priority since we'll already
      // be showing the right content coming from the server, it is no rush.
      workInProgress.expirationTime = Never;
    }
    return null;
  }
  if ((workInProgress.effectTag & DidCapture) !== NoEffect) {
    // Something suspended. Leave the existing children in place.
    // TODO: In non-concurrent mode, should we commit the nodes we have hydrated so far?
    workInProgress.child = null;
    return null;
  }
  if (isSuspenseInstanceFallback(suspenseInstance)) {
    // This boundary is in a permanent fallback state. In this case, we'll never
    // get an update and we'll never be able to hydrate the final content. Let's just try the
    // client side render instead.
    return retrySuspenseComponentWithoutHydrating(
      current,
      workInProgress,
      renderExpirationTime,
    );
  }
  // We use childExpirationTime to indicate that a child might depend on context, so if
  // any context has changed, we need to treat is as if the input might have changed.
  const hasContextChanged = current.childExpirationTime >= renderExpirationTime;
  if (didReceiveUpdate || hasContextChanged) {
    // This boundary has changed since the first render. This means that we are now unable to
    // hydrate it. We might still be able to hydrate it using an earlier expiration time but
    // during this render we can't. Instead, we're going to delete the whole subtree and
    // instead inject a new real Suspense boundary to take its place, which may render content
    // or fallback. The real Suspense boundary will suspend for a while so we have some time
    // to ensure it can produce real content, but all state and pending events will be lost.
    return retrySuspenseComponentWithoutHydrating(
      current,
      workInProgress,
      renderExpirationTime,
    );
  } else if (isSuspenseInstancePending(suspenseInstance)) {
    // This component is still pending more data from the server, so we can't hydrate its
    // content. We treat it as if this component suspended itself. It might seem as if
    // we could just try to render it client-side instead. However, this will perform a
    // lot of unnecessary work and is unlikely to complete since it often will suspend
    // on missing data anyway. Additionally, the server might be able to render more
    // than we can on the client yet. In that case we'd end up with more fallback states
    // on the client than if we just leave it alone. If the server times out or errors
    // these should update this boundary to the permanent Fallback state instead.
    // Mark it as having captured (i.e. suspended).
    workInProgress.effectTag |= DidCapture;
    // Leave the children in place. I.e. empty.
    workInProgress.child = null;
    // Register a callback to retry this boundary once the server has sent the result.
    registerSuspenseInstanceRetry(
      suspenseInstance,
      retryTimedOutBoundary.bind(null, current),
    );
    return null;
  } else {
    // This is the first attempt.
    reenterHydrationStateFromDehydratedSuspenseInstance(workInProgress);
    const nextProps = workInProgress.pendingProps;
    const nextChildren = nextProps.children;
    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderExpirationTime,
    );
    return workInProgress.child;
  }
}

function propagateSuspenseContextChange(
  workInProgress: Fiber,
  firstChild: null | Fiber,
  renderExpirationTime: ExpirationTime,
): void {
  // Mark any Suspense boundaries with fallbacks as having work to do.
  // If they were previously forced into fallbacks, they may now be able
  // to unblock.
  let node = firstChild;
  while (node !== null) {
    if (node.tag === SuspenseComponent) {
      const state: SuspenseState | null = node.memoizedState;
      if (state !== null) {
        if (node.expirationTime < renderExpirationTime) {
          node.expirationTime = renderExpirationTime;
        }
        let alternate = node.alternate;
        if (
          alternate !== null &&
          alternate.expirationTime < renderExpirationTime
        ) {
          alternate.expirationTime = renderExpirationTime;
        }
        scheduleWorkOnParentPath(node.return, renderExpirationTime);
      }
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === workInProgress) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === workInProgress) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function findLastContentRow(firstChild: null | Fiber): null | Fiber {
  // This is going to find the last row among these children that is already
  // showing content on the screen, as opposed to being in fallback state or
  // new. If a row has multiple Suspense boundaries, any of them being in the
  // fallback state, counts as the whole row being in a fallback state.
  // Note that the "rows" will be workInProgress, but any nested children
  // will still be current since we haven't rendered them yet. The mounted
  // order may not be the same as the new order. We use the new order.
  let row = firstChild;
  let lastContentRow: null | Fiber = null;
  while (row !== null) {
    let currentRow = row.alternate;
    // New rows can't be content rows.
    if (currentRow !== null && !isShowingAnyFallbacks(currentRow)) {
      lastContentRow = row;
    }
    row = row.sibling;
  }
  return lastContentRow;
}

type SuspenseListRevealOrder = 'forwards' | 'backwards' | 'together' | void;

function validateRevealOrder(revealOrder: SuspenseListRevealOrder) {
  if (__DEV__) {
    if (
      revealOrder !== undefined &&
      revealOrder !== 'forwards' &&
      revealOrder !== 'backwards' &&
      revealOrder !== 'together' &&
      !didWarnAboutRevealOrder[revealOrder]
    ) {
      didWarnAboutRevealOrder[revealOrder] = true;
      if (typeof revealOrder === 'string') {
        switch (revealOrder.toLowerCase()) {
          case 'together':
          case 'forwards':
          case 'backwards': {
            warning(
              false,
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'Use lowercase "%s" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          case 'forward':
          case 'backward': {
            warning(
              false,
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'React uses the -s suffix in the spelling. Use "%ss" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          default:
            warning(
              false,
              '"%s" is not a supported revealOrder on <SuspenseList />. ' +
                'Did you mean "together", "forwards" or "backwards"?',
              revealOrder,
            );
            break;
        }
      } else {
        warning(
          false,
          '%s is not a supported value for revealOrder on <SuspenseList />. ' +
            'Did you mean "together", "forwards" or "backwards"?',
          revealOrder,
        );
      }
    }
  }
}

function validateTailOptions(
  tailMode: SuspenseListTailMode,
  revealOrder: SuspenseListRevealOrder,
) {
  if (__DEV__) {
    if (tailMode !== undefined && !didWarnAboutTailOptions[tailMode]) {
      if (tailMode !== 'collapsed') {
        didWarnAboutTailOptions[tailMode] = true;
        warning(
          false,
          '"%s" is not a supported value for tail on <SuspenseList />. ' +
            'Did you mean "collapsed"?',
          tailMode,
        );
      } else if (revealOrder !== 'forwards' && revealOrder !== 'backwards') {
        didWarnAboutTailOptions[tailMode] = true;
        warning(
          false,
          '<SuspenseList tail="%s" /> is only valid if revealOrder is ' +
            '"forwards" or "backwards". ' +
            'Did you mean to specify revealOrder="forwards"?',
          tailMode,
        );
      }
    }
  }
}

function initSuspenseListRenderState(
  workInProgress: Fiber,
  isBackwards: boolean,
  tail: null | Fiber,
  lastContentRow: null | Fiber,
  tailMode: SuspenseListTailMode,
): void {
  let renderState: null | SuspenseListRenderState =
    workInProgress.memoizedState;
  if (renderState === null) {
    workInProgress.memoizedState = {
      isBackwards: isBackwards,
      rendering: null,
      last: lastContentRow,
      tail: tail,
      tailExpiration: 0,
      tailMode: tailMode,
    };
  } else {
    // We can reuse the existing object from previous renders.
    renderState.isBackwards = isBackwards;
    renderState.rendering = null;
    renderState.last = lastContentRow;
    renderState.tail = tail;
    renderState.tailExpiration = 0;
    renderState.tailMode = tailMode;
  }
}

// This can end up rendering this component multiple passes.
// The first pass splits the children fibers into two sets. A head and tail.
// We first render the head. If anything is in fallback state, we do another
// pass through beginWork to rerender all children (including the tail) with
// the force suspend context. If the first render didn't have anything in
// in fallback state. Then we render each row in the tail one-by-one.
// That happens in the completeWork phase without going back to beginWork.
function updateSuspenseListComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  const nextProps = workInProgress.pendingProps;
  const revealOrder: SuspenseListRevealOrder = nextProps.revealOrder;
  const tailMode: SuspenseListTailMode = nextProps.tail;
  const newChildren = nextProps.children;

  validateRevealOrder(revealOrder);
  validateTailOptions(tailMode, revealOrder);

  reconcileChildren(current, workInProgress, newChildren, renderExpirationTime);

  let suspenseContext: SuspenseContext = suspenseStackCursor.current;

  let shouldForceFallback = hasSuspenseContext(
    suspenseContext,
    (ForceSuspenseFallback: SuspenseContext),
  );
  if (shouldForceFallback) {
    suspenseContext = setShallowSuspenseContext(
      suspenseContext,
      ForceSuspenseFallback,
    );
    workInProgress.effectTag |= DidCapture;
  } else {
    const didSuspendBefore =
      current !== null && (current.effectTag & DidCapture) !== NoEffect;
    if (didSuspendBefore) {
      // If we previously forced a fallback, we need to schedule work
      // on any nested boundaries to let them know to try to render
      // again. This is the same as context updating.
      propagateSuspenseContextChange(
        workInProgress,
        workInProgress.child,
        renderExpirationTime,
      );
    }
    suspenseContext = setDefaultShallowSuspenseContext(suspenseContext);
  }
  pushSuspenseContext(workInProgress, suspenseContext);

  if ((workInProgress.mode & BatchedMode) === NoMode) {
    workInProgress.memoizedState = null;
  } else {
    // Outside of batched mode, SuspenseList doesn't work so we just
    // use make it a noop by treating it as the default revealOrder.
    switch (revealOrder) {
      case 'forwards': {
        let lastContentRow = findLastContentRow(workInProgress.child);
        let tail;
        if (lastContentRow === null) {
          // The whole list is part of the tail.
          // TODO: We could fast path by just rendering the tail now.
          tail = workInProgress.child;
          workInProgress.child = null;
        } else {
          // Disconnect the tail rows after the content row.
          // We're going to render them separately later.
          tail = lastContentRow.sibling;
          lastContentRow.sibling = null;
        }
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          tail,
          lastContentRow,
          tailMode,
        );
        break;
      }
      case 'backwards': {
        // We're going to find the first row that has existing content.
        // At the same time we're going to reverse the list of everything
        // we pass in the meantime. That's going to be our tail in reverse
        // order.
        let tail = null;
        let row = workInProgress.child;
        workInProgress.child = null;
        while (row !== null) {
          let currentRow = row.alternate;
          // New rows can't be content rows.
          if (currentRow !== null && !isShowingAnyFallbacks(currentRow)) {
            // This is the beginning of the main content.
            workInProgress.child = row;
            break;
          }
          let nextRow = row.sibling;
          row.sibling = tail;
          tail = row;
          row = nextRow;
        }
        // TODO: If workInProgress.child is null, we can continue on the tail immediately.
        initSuspenseListRenderState(
          workInProgress,
          true, // isBackwards
          tail,
          null, // last
          tailMode,
        );
        break;
      }
      case 'together': {
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          null, // tail
          null, // last
          undefined,
        );
        break;
      }
      default: {
        // The default reveal order is the same as not having
        // a boundary.
        workInProgress.memoizedState = null;
      }
    }
  }
  return workInProgress.child;
}

function updatePortalComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo);
  const nextChildren = workInProgress.pendingProps;
  if (current === null) {
    // Portals are special because we don't append the children during mount
    // but at commit. Therefore we need to track insertions which the normal
    // flow doesn't do during mount. This doesn't happen at the root because
    // the root always starts with a "current" with a null child.
    // TODO: Consider unifying this with how the root works.
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderExpirationTime,
    );
  } else {
    reconcileChildren(
      current,
      workInProgress,
      nextChildren,
      renderExpirationTime,
    );
  }
  return workInProgress.child;
}

function updateContextProvider(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  const providerType: ReactProviderType<any> = workInProgress.type;
  const context: ReactContext<any> = providerType._context;

  const newProps = workInProgress.pendingProps;
  const oldProps = workInProgress.memoizedProps;

  const newValue = newProps.value;

  if (__DEV__) {
    const providerPropTypes = workInProgress.type.propTypes;

    if (providerPropTypes) {
      checkPropTypes(
        providerPropTypes,
        newProps,
        'prop',
        'Context.Provider',
        getCurrentFiberStackInDev,
      );
    }
  }

  pushProvider(workInProgress, newValue);

  if (oldProps !== null) {
    const oldValue = oldProps.value;
    const changedBits = calculateChangedBits(context, newValue, oldValue);
    if (changedBits === 0) {
      // No change. Bailout early if children are the same.
      if (
        oldProps.children === newProps.children &&
        !hasLegacyContextChanged()
      ) {
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderExpirationTime,
        );
      }
    } else {
      // The context value changed. Search for matching consumers and schedule
      // them to update.
      propagateContextChange(
        workInProgress,
        context,
        changedBits,
        renderExpirationTime,
      );
    }
  }

  const newChildren = newProps.children;
  reconcileChildren(current, workInProgress, newChildren, renderExpirationTime);
  return workInProgress.child;
}

let hasWarnedAboutUsingContextAsConsumer = false;

function updateContextConsumer(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  let context: ReactContext<any> = workInProgress.type;
  // The logic below for Context differs depending on PROD or DEV mode. In
  // DEV mode, we create a separate object for Context.Consumer that acts
  // like a proxy to Context. This proxy object adds unnecessary code in PROD
  // so we use the old behaviour (Context.Consumer references Context) to
  // reduce size and overhead. The separate object references context via
  // a property called "_context", which also gives us the ability to check
  // in DEV mode if this property exists or not and warn if it does not.
  if (__DEV__) {
    if ((context: any)._context === undefined) {
      // This may be because it's a Context (rather than a Consumer).
      // Or it may be because it's older React where they're the same thing.
      // We only want to warn if we're sure it's a new React.
      if (context !== context.Consumer) {
        if (!hasWarnedAboutUsingContextAsConsumer) {
          hasWarnedAboutUsingContextAsConsumer = true;
          warning(
            false,
            'Rendering <Context> directly is not supported and will be removed in ' +
              'a future major release. Did you mean to render <Context.Consumer> instead?',
          );
        }
      }
    } else {
      context = (context: any)._context;
    }
  }
  const newProps = workInProgress.pendingProps;
  const render = newProps.children;

  if (__DEV__) {
    warningWithoutStack(
      typeof render === 'function',
      'A context consumer was rendered with multiple children, or a child ' +
        "that isn't a function. A context consumer expects a single child " +
        'that is a function. If you did pass a function, make sure there ' +
        'is no trailing or leading whitespace around it.',
    );
  }

  prepareToReadContext(workInProgress, renderExpirationTime);
  const newValue = readContext(context, newProps.unstable_observedBits);
  let newChildren;
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setCurrentPhase('render');
    newChildren = render(newValue);
    setCurrentPhase(null);
  } else {
    newChildren = render(newValue);
  }

  // React DevTools reads this flag.
  workInProgress.effectTag |= PerformedWork;
  reconcileChildren(current, workInProgress, newChildren, renderExpirationTime);
  return workInProgress.child;
}

function updateEventComponent(current, workInProgress, renderExpirationTime) {
  const nextProps = workInProgress.pendingProps;
  let nextChildren = nextProps.children;

  reconcileChildren(
    current,
    workInProgress,
    nextChildren,
    renderExpirationTime,
  );
  pushHostContextForEventComponent(workInProgress);
  return workInProgress.child;
}

export function markWorkInProgressReceivedUpdate() {
  didReceiveUpdate = true;
}

//根据之前设置的childExpirationTime来判断子树是否需要更新

//跳过该节点及所有子节点的更新
function bailoutOnAlreadyFinishedWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
): Fiber | null {
  //不看
  cancelWorkTimer(workInProgress);

  if (current !== null) {
    // Reuse previous dependencies
    workInProgress.dependencies = current.dependencies;
  }

  if (enableProfilerTimer) {
    // Don't update "base" render times for bailouts.
    stopProfilerTimerIfRunning(workInProgress);
  }

  // Check if the children have any pending work.
  //expirationTime 表示该节点是否有更新，如果该节点有更新，可能会影响子节点的更新
  //如果expirationTime和childExpirationTime都没有，则子树是不需要更新的

  //由于子孙节点造成的更新
  const childExpirationTime = workInProgress.childExpirationTime;
  //如果子树不需要更新，则返回 null

  //childExpirationTime的一个好处就是快捷地知道子树有没有更新，从而跳过没有更新的子树
  //如果childExpirationTime为空，react 还需要遍历子树来判断是否更新
  if (childExpirationTime < renderExpirationTime) {
    // The children don't have any work either. We can skip them.
    // TODO: Once we add back resuming, we should check if the children are
    // a work-in-progress set. If so, we need to transfer their effects.

    //跳过整个子树的更新渲染，这是一个非常大的优化
    return null;
  }
  //调和子节点
  else {
    // This fiber doesn't have work, but its subtree does. Clone the child
    // fibers and continue.
    //该节点不需要更新，子节点也不需要更新，所以只要复制子节点过来即可
    cloneChildFibers(current, workInProgress);
    return workInProgress.child;
  }
}

function remountFiber(
  current: Fiber,
  oldWorkInProgress: Fiber,
  newWorkInProgress: Fiber,
): Fiber | null {
  if (__DEV__) {
    const returnFiber = oldWorkInProgress.return;
    if (returnFiber === null) {
      throw new Error('Cannot swap the root fiber.');
    }

    // Disconnect from the old current.
    // It will get deleted.
    current.alternate = null;
    oldWorkInProgress.alternate = null;

    // Connect to the new tree.
    newWorkInProgress.index = oldWorkInProgress.index;
    newWorkInProgress.sibling = oldWorkInProgress.sibling;
    newWorkInProgress.return = oldWorkInProgress.return;

    // Replace the child/sibling pointers above it.
    if (oldWorkInProgress === returnFiber.child) {
      returnFiber.child = newWorkInProgress;
    } else {
      let prevSibling = returnFiber.child;
      if (prevSibling === null) {
        throw new Error('Expected parent to have a child.');
      }
      while (prevSibling.sibling !== oldWorkInProgress) {
        prevSibling = prevSibling.sibling;
        if (prevSibling === null) {
          throw new Error('Expected to find the previous sibling.');
        }
      }
      prevSibling.sibling = newWorkInProgress;
    }

    // Delete the old fiber and place the new one.
    // Since the old fiber is disconnected, we have to schedule it manually.
    const last = returnFiber.lastEffect;
    if (last !== null) {
      last.nextEffect = current;
      returnFiber.lastEffect = current;
    } else {
      returnFiber.firstEffect = returnFiber.lastEffect = current;
    }
    current.nextEffect = null;
    current.effectTag = Deletion;

    newWorkInProgress.effectTag |= Placement;

    // Restart work from the new fiber.
    return newWorkInProgress;
  } else {
    throw new Error(
      'Did not expect this call in production. ' +
        'This is a bug in React. Please file an issue.',
    );
  }
}

//判断fiber有无更新，有更新则进行相应的组件更新，无更新则复制节点
//current: workInProgress.alternate
function beginWork(
  current: Fiber | null,
  //workInProgress创建的子节点也是workInProgress
  workInProgress: Fiber,
  //标记 该次渲染中，优先级最高的点
  renderExpirationTime: ExpirationTime,
): Fiber | null {
  //只有当调用 react.domRender的时候，rootFiber的expirationTime才有值，rootFiber 才会更新

  //获取 fiber 对象上更新的过期时间
  const updateExpirationTime = workInProgress.expirationTime;


  //判断是不是第一次渲染
  //如果不是第一次渲染
  if (current !== null) {
    //上一次渲染完成后的props,即 oldProps
    const oldProps = current.memoizedProps;
    //新的变动带来的props，即newProps
    const newProps = workInProgress.pendingProps;

    if (
      //前后 props 是否不相等
      oldProps !== newProps ||
      //是否有老版本的 context 使用，并且发生了变化
      hasLegacyContextChanged() ||
      // Force a re-render if the implementation changed due to hot reload:
      //开发环境永远是 false
      (__DEV__ ? workInProgress.type !== current.type : false)
    ) {
      // If props or context changed, mark the fiber as having performed work.
      // This may be unset if the props are determined to be equal later (memo).
      //判断接收到了更新 update
      didReceiveUpdate = true;
    }
    //有更新，但是优先级不高，在本次渲染过程中不需要执行，设为 false
    else if (updateExpirationTime < renderExpirationTime) {
      didReceiveUpdate = false;
      // This fiber does not have any pending work. Bailout without entering
      // the begin phase. There's still some bookkeeping we that needs to be done
      // in this optimized path, mostly pushing stuff onto the stack.
      //根据workInProgress的tag，进行相应组件的更新
      switch (workInProgress.tag) {
        case HostRoot:
          pushHostRootContext(workInProgress);
          resetHydrationState();
          break;
        case HostComponent:
          pushHostContext(workInProgress);
          if (
            workInProgress.mode & ConcurrentMode &&
            renderExpirationTime !== Never &&
            shouldDeprioritizeSubtree(workInProgress.type, newProps)
          ) {
            if (enableSchedulerTracing) {
              markSpawnedWork(Never);
            }
            // Schedule this fiber to re-render at offscreen priority. Then bailout.
            workInProgress.expirationTime = workInProgress.childExpirationTime = Never;
            return null;
          }
          break;
        case ClassComponent: {
          const Component = workInProgress.type;
          if (isLegacyContextProvider(Component)) {
            pushLegacyContextProvider(workInProgress);
          }
          break;
        }
        case HostPortal:
          pushHostContainer(
            workInProgress,
            workInProgress.stateNode.containerInfo,
          );
          break;
        case ContextProvider: {
          const newValue = workInProgress.memoizedProps.value;
          pushProvider(workInProgress, newValue);
          break;
        }
        case Profiler:
          if (enableProfilerTimer) {
            workInProgress.effectTag |= Update;
          }
          break;
        case SuspenseComponent: {
          const state: SuspenseState | null = workInProgress.memoizedState;
          const didTimeout = state !== null;
          if (didTimeout) {
            // If this boundary is currently timed out, we need to decide
            // whether to retry the primary children, or to skip over it and
            // go straight to the fallback. Check the priority of the primary
            // child fragment.
            const primaryChildFragment: Fiber = (workInProgress.child: any);
            const primaryChildExpirationTime =
              primaryChildFragment.childExpirationTime;
            if (
              primaryChildExpirationTime !== NoWork &&
              primaryChildExpirationTime >= renderExpirationTime
            ) {
              // The primary children have pending work. Use the normal path
              // to attempt to render the primary children again.
              return updateSuspenseComponent(
                current,
                workInProgress,
                renderExpirationTime,
              );
            } else {
              pushSuspenseContext(
                workInProgress,
                setDefaultShallowSuspenseContext(suspenseStackCursor.current),
              );
              // The primary children do not have pending work with sufficient
              // priority. Bailout.
              const child = bailoutOnAlreadyFinishedWork(
                current,
                workInProgress,
                renderExpirationTime,
              );
              if (child !== null) {
                // The fallback children have pending work. Skip over the
                // primary children and work on the fallback.
                return child.sibling;
              } else {
                return null;
              }
            }
          } else {
            pushSuspenseContext(
              workInProgress,
              setDefaultShallowSuspenseContext(suspenseStackCursor.current),
            );
          }
          break;
        }
        case DehydratedSuspenseComponent: {
          if (enableSuspenseServerRenderer) {
            pushSuspenseContext(
              workInProgress,
              setDefaultShallowSuspenseContext(suspenseStackCursor.current),
            );
            // We know that this component will suspend again because if it has
            // been unsuspended it has committed as a regular Suspense component.
            // If it needs to be retried, it should have work scheduled on it.
            workInProgress.effectTag |= DidCapture;
          }
          break;
        }
        case SuspenseListComponent: {
          const didSuspendBefore =
            (current.effectTag & DidCapture) !== NoEffect;

          const childExpirationTime = workInProgress.childExpirationTime;
          if (childExpirationTime < renderExpirationTime) {
            // If none of the children had any work, that means that none of
            // them got retried so they'll still be blocked in the same way
            // as before. We can fast bail out.
            pushSuspenseContext(workInProgress, suspenseStackCursor.current);
            if (didSuspendBefore) {
              workInProgress.effectTag |= DidCapture;
            }
            return null;
          }

          if (didSuspendBefore) {
            // If something was in fallback state last time, and we have all the
            // same children then we're still in progressive loading state.
            // Something might get unblocked by state updates or retries in the
            // tree which will affect the tail. So we need to use the normal
            // path to compute the correct tail.
            return updateSuspenseListComponent(
              current,
              workInProgress,
              renderExpirationTime,
            );
          }

          // If nothing suspended before and we're rendering the same children,
          // then the tail doesn't matter. Anything new that suspends will work
          // in the "together" mode, so we can continue from the state we had.
          let renderState = workInProgress.memoizedState;
          if (renderState !== null) {
            // Reset to the "together" mode in case we've started a different
            // update in the past but didn't complete it.
            renderState.rendering = null;
            renderState.tail = null;
          }
          pushSuspenseContext(workInProgress, suspenseStackCursor.current);
          break;
        }
        case EventComponent:
          if (enableFlareAPI) {
            pushHostContextForEventComponent(workInProgress);
          }
          break;
      }
      //跳过该节点及所有子节点的更新
      return bailoutOnAlreadyFinishedWork(
        current,
        workInProgress,
        renderExpirationTime,
      );
    }
  } else {
    didReceiveUpdate = false;
  }

  // Before entering the begin phase, clear the expiration time.
  workInProgress.expirationTime = NoWork;
  //如果节点是有更新的
  //根据节点类型进行组件的更新
  switch (workInProgress.tag) {
    case IndeterminateComponent: {
      // 进一步明确 FunctionComponent 以何种方式更新
      return mountIndeterminateComponent(
        current,
        workInProgress,
        workInProgress.type,
        renderExpirationTime,
      );
    }
    case LazyComponent: {
      const elementType = workInProgress.elementType;
      return mountLazyComponent(
        current,
        workInProgress,
        elementType,
        updateExpirationTime,
        renderExpirationTime,
      );
    }
    //FunctionComponent的更新
    case FunctionComponent: {
      //React 组件的类型，FunctionComponent的类型是 function，ClassComponent的类型是 class
      const Component = workInProgress.type;
      //下次渲染待更新的 props
      const unresolvedProps = workInProgress.pendingProps;
      // pendingProps
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      //更新 FunctionComponent
      //可以看到大部分是workInProgress的属性
      //之所以定义变量再传进去，是为了“冻结”workInProgress的属性，防止在 function 里会改变workInProgress的属性
      return updateFunctionComponent(
        //workInProgress.alternate
        current,
        workInProgress,
        //workInProgress.type
        Component,
        //workInProgress.pendingProps
        resolvedProps,
        renderExpirationTime,
      );
    }
    //ClassComponent的更新
    case ClassComponent: {
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      return updateClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
    }
    case HostRoot:
      return updateHostRoot(current, workInProgress, renderExpirationTime);
    case HostComponent:
      //更新 DOM 标签
      return updateHostComponent(current, workInProgress, renderExpirationTime);
    case HostText:
      //更新文本节点
      return updateHostText(current, workInProgress);
    case SuspenseComponent:
      return updateSuspenseComponent(
        current,
        workInProgress,
        renderExpirationTime,
      );
    case HostPortal:
      return updatePortalComponent(
        current,
        workInProgress,
        renderExpirationTime,
      );
    case ForwardRef: {
      const type = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === type
          ? unresolvedProps
          : resolveDefaultProps(type, unresolvedProps);
      return updateForwardRef(
        current,
        workInProgress,
        type,
        resolvedProps,
        renderExpirationTime,
      );
    }
    case Fragment:
      return updateFragment(current, workInProgress, renderExpirationTime);
    case Mode:
      return updateMode(current, workInProgress, renderExpirationTime);
    case Profiler:
      return updateProfiler(current, workInProgress, renderExpirationTime);
    case ContextProvider:
      return updateContextProvider(
        current,
        workInProgress,
        renderExpirationTime,
      );
    case ContextConsumer:
      return updateContextConsumer(
        current,
        workInProgress,
        renderExpirationTime,
      );
    case MemoComponent: {
      const type = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      // Resolve outer props first, then resolve inner props.
      let resolvedProps = resolveDefaultProps(type, unresolvedProps);
      if (__DEV__) {
        if (workInProgress.type !== workInProgress.elementType) {
          const outerPropTypes = type.propTypes;
          if (outerPropTypes) {
            checkPropTypes(
              outerPropTypes,
              resolvedProps, // Resolved for outer only
              'prop',
              getComponentName(type),
              getCurrentFiberStackInDev,
            );
          }
        }
      }
      resolvedProps = resolveDefaultProps(type.type, resolvedProps);
      return updateMemoComponent(
        current,
        workInProgress,
        type,
        resolvedProps,
        updateExpirationTime,
        renderExpirationTime,
      );
    }
    case SimpleMemoComponent: {
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        updateExpirationTime,
        renderExpirationTime,
      );
    }
    case IncompleteClassComponent: {
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      return mountIncompleteClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderExpirationTime,
      );
    }
    case DehydratedSuspenseComponent: {
      if (enableSuspenseServerRenderer) {
        return updateDehydratedSuspenseComponent(
          current,
          workInProgress,
          renderExpirationTime,
        );
      }
      break;
    }
    case SuspenseListComponent: {
      return updateSuspenseListComponent(
        current,
        workInProgress,
        renderExpirationTime,
      );
    }
    case EventComponent: {
      if (enableFlareAPI) {
        return updateEventComponent(
          current,
          workInProgress,
          renderExpirationTime,
        );
      }
      break;
    }
  }
  invariant(
    false,
    'Unknown unit of work tag. This error is likely caused by a bug in ' +
      'React. Please file an issue.',
  );
}

export {beginWork};
