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

import React from 'react';
import {Update, Snapshot} from 'shared/ReactSideEffectTags';
import {
  debugRenderPhaseSideEffects,
  debugRenderPhaseSideEffectsForStrictMode,
  warnAboutDeprecatedLifecycles,
} from 'shared/ReactFeatureFlags';
import ReactStrictModeWarnings from './ReactStrictModeWarnings';
import {isMounted} from 'react-reconciler/reflection';
import {get as getInstance, set as setInstance} from 'shared/ReactInstanceMap';
import shallowEqual from 'shared/shallowEqual';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';
import warningWithoutStack from 'shared/warningWithoutStack';
import {REACT_CONTEXT_TYPE, REACT_PROVIDER_TYPE} from 'shared/ReactSymbols';

import {startPhaseTimer, stopPhaseTimer} from './ReactDebugFiberPerf';
import {resolveDefaultProps} from './ReactFiberLazyComponent';
import {StrictMode} from './ReactTypeOfMode';

import {
  enqueueUpdate,
  processUpdateQueue,
  checkHasForceUpdateAfterProcessing,
  resetHasForceUpdateBeforeProcessing,
  createUpdate,
  ReplaceState,
  ForceUpdate,
} from './ReactUpdateQueue';
import {NoWork} from './ReactFiberExpirationTime';
import {
  cacheContext,
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged,
  emptyContextObject,
} from './ReactFiberContext';
import {readContext} from './ReactFiberNewContext';
import {
  requestCurrentTime,
  computeExpirationForFiber,
  scheduleWork,
  flushPassiveEffects,
} from './ReactFiberWorkLoop';
import {revertPassiveEffectsChange} from 'shared/ReactFeatureFlags';
import {requestCurrentSuspenseConfig} from './ReactFiberSuspenseConfig';

const fakeInternalInstance = {};
const isArray = Array.isArray;

// React.Component uses a shared frozen object by default.
// We'll use it to determine whether we need to initialize legacy refs.
export const emptyRefsObject = new React.Component().refs;

let didWarnAboutStateAssignmentForComponent;
let didWarnAboutUninitializedState;
let didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate;
let didWarnAboutLegacyLifecyclesAndDerivedState;
let didWarnAboutUndefinedDerivedState;
let warnOnUndefinedDerivedState;
let warnOnInvalidCallback;
let didWarnAboutDirectlyAssigningPropsToState;
let didWarnAboutContextTypeAndContextTypes;
let didWarnAboutInvalidateContextType;

if (__DEV__) {
  didWarnAboutStateAssignmentForComponent = new Set();
  didWarnAboutUninitializedState = new Set();
  didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate = new Set();
  didWarnAboutLegacyLifecyclesAndDerivedState = new Set();
  didWarnAboutDirectlyAssigningPropsToState = new Set();
  didWarnAboutUndefinedDerivedState = new Set();
  didWarnAboutContextTypeAndContextTypes = new Set();
  didWarnAboutInvalidateContextType = new Set();

  const didWarnOnInvalidCallback = new Set();

  warnOnInvalidCallback = function(callback: mixed, callerName: string) {
    if (callback === null || typeof callback === 'function') {
      return;
    }
    const key = `${callerName}_${(callback: any)}`;
    if (!didWarnOnInvalidCallback.has(key)) {
      didWarnOnInvalidCallback.add(key);
      warningWithoutStack(
        false,
        '%s(...): Expected the last optional `callback` argument to be a ' +
          'function. Instead received: %s.',
        callerName,
        callback,
      );
    }
  };

  warnOnUndefinedDerivedState = function(type, partialState) {
    if (partialState === undefined) {
      const componentName = getComponentName(type) || 'Component';
      if (!didWarnAboutUndefinedDerivedState.has(componentName)) {
        didWarnAboutUndefinedDerivedState.add(componentName);
        warningWithoutStack(
          false,
          '%s.getDerivedStateFromProps(): A valid state object (or null) must be returned. ' +
            'You have returned undefined.',
          componentName,
        );
      }
    }
  };

  // This is so gross but it's at least non-critical and can be removed if
  // it causes problems. This is meant to give a nicer error message for
  // ReactDOM15.unstable_renderSubtreeIntoContainer(reactDOM16Component,
  // ...)) which otherwise throws a "_processChildContext is not a function"
  // exception.
  Object.defineProperty(fakeInternalInstance, '_processChildContext', {
    enumerable: false,
    value: function() {
      invariant(
        false,
        '_processChildContext is not available in React 16+. This likely ' +
          'means you have multiple copies of React and are attempting to nest ' +
          'a React 15 tree inside a React 16 tree using ' +
          "unstable_renderSubtreeIntoContainer, which isn't supported. Try " +
          'to make sure you have only one copy of React (and ideally, switch ' +
          'to ReactDOM.createPortal).',
      );
    },
  });
  Object.freeze(fakeInternalInstance);
}

export function applyDerivedStateFromProps(
  workInProgress: Fiber,
  ctor: any,
  getDerivedStateFromProps: (props: any, state: any) => any,
  nextProps: any,
) {
  const prevState = workInProgress.memoizedState;

  if (__DEV__) {
    if (
      debugRenderPhaseSideEffects ||
      (debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictMode)
    ) {
      // Invoke the function an extra time to help detect side-effects.
      getDerivedStateFromProps(nextProps, prevState);
    }
  }

  const partialState = getDerivedStateFromProps(nextProps, prevState);

  if (__DEV__) {
    warnOnUndefinedDerivedState(ctor, partialState);
  }
  // Merge the partial state and the previous state.
  const memoizedState =
    partialState === null || partialState === undefined
      ? prevState
      : Object.assign({}, prevState, partialState);
  workInProgress.memoizedState = memoizedState;

  // Once the update queue is empty, persist the derived state onto the
  // base state.
  const updateQueue = workInProgress.updateQueue;
  if (updateQueue !== null && workInProgress.expirationTime === NoWork) {
    updateQueue.baseState = memoizedState;
  }
}

//classComponent初始化的时候拿到的update对象
const classComponentUpdater = {
  isMounted,
  enqueueSetState(inst, payload, callback) {
    //inst即调用this.setState时传进来的this
    //也就是classComponent实例

    //通过this获取fiber对象
    //this._reactInternalFiber
    //this本身有存储 fiber对象 的属性，叫 _reactInternalFiber
    const fiber = getInstance(inst);
    //计算当前时间，之前讲过 不讲了
    const currentTime = requestCurrentTime();
    //异步加载的设置，暂时不讲
    const suspenseConfig = requestCurrentSuspenseConfig();
    //计算fiber对象的过期时间
    const expirationTime = computeExpirationForFiber(
      currentTime,
      fiber,
      suspenseConfig,
    );
    //创建update对象
    const update = createUpdate(expirationTime, suspenseConfig);
    //setState传进来的要更新的对象
    update.payload = payload;
    //callback就是setState({},()=>{})的回调函数
    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'setState');
      }
      update.callback = callback;
    }
    //暂时不管
    if (revertPassiveEffectsChange) {
      flushPassiveEffects();
    }
    //update入队
    enqueueUpdate(fiber, update);
    //任务调度
    scheduleWork(fiber, expirationTime);
  },
  enqueueReplaceState(inst, payload, callback) {
    const fiber = getInstance(inst);
    const currentTime = requestCurrentTime();
    const suspenseConfig = requestCurrentSuspenseConfig();
    const expirationTime = computeExpirationForFiber(
      currentTime,
      fiber,
      suspenseConfig,
    );

    const update = createUpdate(expirationTime, suspenseConfig);
    update.tag = ReplaceState;
    update.payload = payload;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'replaceState');
      }
      update.callback = callback;
    }

    if (revertPassiveEffectsChange) {
      flushPassiveEffects();
    }
    enqueueUpdate(fiber, update);
    scheduleWork(fiber, expirationTime);
  },
  enqueueForceUpdate(inst, callback) {
    const fiber = getInstance(inst);
    const currentTime = requestCurrentTime();
    const suspenseConfig = requestCurrentSuspenseConfig();
    const expirationTime = computeExpirationForFiber(
      currentTime,
      fiber,
      suspenseConfig,
    );

    const update = createUpdate(expirationTime, suspenseConfig);
    //与setState不同的地方
    //默认是0更新，需要改成2强制更新
    update.tag = ForceUpdate;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'forceUpdate');
      }
      update.callback = callback;
    }

    if (revertPassiveEffectsChange) {
      flushPassiveEffects();
    }
    enqueueUpdate(fiber, update);
    scheduleWork(fiber, expirationTime);
  },
};
//检查是否有 props/state 的更新，也是判断是否需要执行 shouldComponentUpdate() 的方法
function checkShouldComponentUpdate(
  workInProgress,
  ctor,
  oldProps,
  newProps,
  oldState,
  newState,
  nextContext,
) {
  const instance = workInProgress.stateNode;
  //如果有调用`shouldComponentUpdate()`的话，则返回执行该方法的结果
  if (typeof instance.shouldComponentUpdate === 'function') {
    startPhaseTimer(workInProgress, 'shouldComponentUpdate');
    const shouldUpdate = instance.shouldComponentUpdate(
      newProps,
      newState,
      nextContext,
    );
    stopPhaseTimer();

    //删除 dev 代码
    //返回true/false
    return shouldUpdate;
  }
  //如果是纯组件的话，用**浅比较**来比较 props/state
  if (ctor.prototype && ctor.prototype.isPureReactComponent) {
    return (
      //浅等于的判断
      !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState)
    );
  }

  return true;
}

function checkClassInstance(workInProgress: Fiber, ctor: any, newProps: any) {
  const instance = workInProgress.stateNode;
  if (__DEV__) {
    const name = getComponentName(ctor) || 'Component';
    const renderPresent = instance.render;

    if (!renderPresent) {
      if (ctor.prototype && typeof ctor.prototype.render === 'function') {
        warningWithoutStack(
          false,
          '%s(...): No `render` method found on the returned component ' +
            'instance: did you accidentally return an object from the constructor?',
          name,
        );
      } else {
        warningWithoutStack(
          false,
          '%s(...): No `render` method found on the returned component ' +
            'instance: you may have forgotten to define `render`.',
          name,
        );
      }
    }

    const noGetInitialStateOnES6 =
      !instance.getInitialState ||
      instance.getInitialState.isReactClassApproved ||
      instance.state;
    warningWithoutStack(
      noGetInitialStateOnES6,
      'getInitialState was defined on %s, a plain JavaScript class. ' +
        'This is only supported for classes created using React.createClass. ' +
        'Did you mean to define a state property instead?',
      name,
    );
    const noGetDefaultPropsOnES6 =
      !instance.getDefaultProps ||
      instance.getDefaultProps.isReactClassApproved;
    warningWithoutStack(
      noGetDefaultPropsOnES6,
      'getDefaultProps was defined on %s, a plain JavaScript class. ' +
        'This is only supported for classes created using React.createClass. ' +
        'Use a static property to define defaultProps instead.',
      name,
    );
    const noInstancePropTypes = !instance.propTypes;
    warningWithoutStack(
      noInstancePropTypes,
      'propTypes was defined as an instance property on %s. Use a static ' +
        'property to define propTypes instead.',
      name,
    );
    const noInstanceContextType = !instance.contextType;
    warningWithoutStack(
      noInstanceContextType,
      'contextType was defined as an instance property on %s. Use a static ' +
        'property to define contextType instead.',
      name,
    );
    const noInstanceContextTypes = !instance.contextTypes;
    warningWithoutStack(
      noInstanceContextTypes,
      'contextTypes was defined as an instance property on %s. Use a static ' +
        'property to define contextTypes instead.',
      name,
    );

    if (
      ctor.contextType &&
      ctor.contextTypes &&
      !didWarnAboutContextTypeAndContextTypes.has(ctor)
    ) {
      didWarnAboutContextTypeAndContextTypes.add(ctor);
      warningWithoutStack(
        false,
        '%s declares both contextTypes and contextType static properties. ' +
          'The legacy contextTypes property will be ignored.',
        name,
      );
    }

    const noComponentShouldUpdate =
      typeof instance.componentShouldUpdate !== 'function';
    warningWithoutStack(
      noComponentShouldUpdate,
      '%s has a method called ' +
        'componentShouldUpdate(). Did you mean shouldComponentUpdate()? ' +
        'The name is phrased as a question because the function is ' +
        'expected to return a value.',
      name,
    );
    if (
      ctor.prototype &&
      ctor.prototype.isPureReactComponent &&
      typeof instance.shouldComponentUpdate !== 'undefined'
    ) {
      warningWithoutStack(
        false,
        '%s has a method called shouldComponentUpdate(). ' +
          'shouldComponentUpdate should not be used when extending React.PureComponent. ' +
          'Please extend React.Component if shouldComponentUpdate is used.',
        getComponentName(ctor) || 'A pure component',
      );
    }
    const noComponentDidUnmount =
      typeof instance.componentDidUnmount !== 'function';
    warningWithoutStack(
      noComponentDidUnmount,
      '%s has a method called ' +
        'componentDidUnmount(). But there is no such lifecycle method. ' +
        'Did you mean componentWillUnmount()?',
      name,
    );
    const noComponentDidReceiveProps =
      typeof instance.componentDidReceiveProps !== 'function';
    warningWithoutStack(
      noComponentDidReceiveProps,
      '%s has a method called ' +
        'componentDidReceiveProps(). But there is no such lifecycle method. ' +
        'If you meant to update the state in response to changing props, ' +
        'use componentWillReceiveProps(). If you meant to fetch data or ' +
        'run side-effects or mutations after React has updated the UI, use componentDidUpdate().',
      name,
    );
    const noComponentWillRecieveProps =
      typeof instance.componentWillRecieveProps !== 'function';
    warningWithoutStack(
      noComponentWillRecieveProps,
      '%s has a method called ' +
        'componentWillRecieveProps(). Did you mean componentWillReceiveProps()?',
      name,
    );
    const noUnsafeComponentWillRecieveProps =
      typeof instance.UNSAFE_componentWillRecieveProps !== 'function';
    warningWithoutStack(
      noUnsafeComponentWillRecieveProps,
      '%s has a method called ' +
        'UNSAFE_componentWillRecieveProps(). Did you mean UNSAFE_componentWillReceiveProps()?',
      name,
    );
    const hasMutatedProps = instance.props !== newProps;
    warningWithoutStack(
      instance.props === undefined || !hasMutatedProps,
      '%s(...): When calling super() in `%s`, make sure to pass ' +
        "up the same props that your component's constructor was passed.",
      name,
      name,
    );
    const noInstanceDefaultProps = !instance.defaultProps;
    warningWithoutStack(
      noInstanceDefaultProps,
      'Setting defaultProps as an instance property on %s is not supported and will be ignored.' +
        ' Instead, define defaultProps as a static property on %s.',
      name,
      name,
    );

    if (
      typeof instance.getSnapshotBeforeUpdate === 'function' &&
      typeof instance.componentDidUpdate !== 'function' &&
      !didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.has(ctor)
    ) {
      didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.add(ctor);
      warningWithoutStack(
        false,
        '%s: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). ' +
          'This component defines getSnapshotBeforeUpdate() only.',
        getComponentName(ctor),
      );
    }

    const noInstanceGetDerivedStateFromProps =
      typeof instance.getDerivedStateFromProps !== 'function';
    warningWithoutStack(
      noInstanceGetDerivedStateFromProps,
      '%s: getDerivedStateFromProps() is defined as an instance method ' +
        'and will be ignored. Instead, declare it as a static method.',
      name,
    );
    const noInstanceGetDerivedStateFromCatch =
      typeof instance.getDerivedStateFromError !== 'function';
    warningWithoutStack(
      noInstanceGetDerivedStateFromCatch,
      '%s: getDerivedStateFromError() is defined as an instance method ' +
        'and will be ignored. Instead, declare it as a static method.',
      name,
    );
    const noStaticGetSnapshotBeforeUpdate =
      typeof ctor.getSnapshotBeforeUpdate !== 'function';
    warningWithoutStack(
      noStaticGetSnapshotBeforeUpdate,
      '%s: getSnapshotBeforeUpdate() is defined as a static method ' +
        'and will be ignored. Instead, declare it as an instance method.',
      name,
    );
    const state = instance.state;
    if (state && (typeof state !== 'object' || isArray(state))) {
      warningWithoutStack(
        false,
        '%s.state: must be set to an object or null',
        name,
      );
    }
    if (typeof instance.getChildContext === 'function') {
      warningWithoutStack(
        typeof ctor.childContextTypes === 'object',
        '%s.getChildContext(): childContextTypes must be defined in order to ' +
          'use getChildContext().',
        name,
      );
    }
  }
}
//初始化 class 实例，即初始化workInProgress和instance
function adoptClassInstance(workInProgress: Fiber, instance: any): void {
  instance.updater = classComponentUpdater;
  workInProgress.stateNode = instance;
  // The instance needs access to the fiber so that it can schedule updates
  //ReactInstanceMap.set(instance, workInProgress)
  setInstance(instance, workInProgress);
  if (__DEV__) {
    instance._reactInternalInstance = fakeInternalInstance;
  }
}
//构建 class 实例
function constructClassInstance(
  workInProgress: Fiber,
  ctor: any,
  props: any,
  renderExpirationTime: ExpirationTime,
): any {
  let isLegacyContextConsumer = false;
  let unmaskedContext = emptyContextObject;
  let context = null;
  const contextType = ctor.contextType;
  //删除了 dev 代码
  //=============context 部分可跳过====================================================
  if (typeof contextType === 'object' && contextType !== null) {
    context = readContext((contextType: any));
  } else {
    unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    const contextTypes = ctor.contextTypes;
    isLegacyContextConsumer =
      contextTypes !== null && contextTypes !== undefined;
    context = isLegacyContextConsumer
      ? getMaskedContext(workInProgress, unmaskedContext)
      : emptyContextObject;
  }
  //==========================================================================

  // Instantiate twice to help detect side-effects.
  //删除了 dev 代码
  //ctor即workInProgress.type，也就是定义classComponet的类
  //2020513，在这边 new 了 class App{}
  const instance = new ctor(props, context);
  // instance.state 即开发层面的 this.state
  // 注意这个写法，连等赋值
  const state = (workInProgress.memoizedState =
    instance.state !== null && instance.state !== undefined
      ? instance.state
      : null);
  // 初始化 class 实例，即初始化workInProgress和instance
  adoptClassInstance(workInProgress, instance);

  //删除了 dev 代码

  // Cache unmasked context so we can avoid recreating masked context unless necessary.
  // ReactFiberContext usually updates this cache but can't for newly-created instances.
  //context 相关，可跳过
  if (isLegacyContextConsumer) {
    cacheContext(workInProgress, unmaskedContext, context);
  }

  return instance;
}

function callComponentWillMount(workInProgress, instance) {
  startPhaseTimer(workInProgress, 'componentWillMount');
  const oldState = instance.state;

  if (typeof instance.componentWillMount === 'function') {
    instance.componentWillMount();
  }
  if (typeof instance.UNSAFE_componentWillMount === 'function') {
    instance.UNSAFE_componentWillMount();
  }

  stopPhaseTimer();

  if (oldState !== instance.state) {
    if (__DEV__) {
      warningWithoutStack(
        false,
        '%s.componentWillMount(): Assigning directly to this.state is ' +
          "deprecated (except inside a component's " +
          'constructor). Use setState instead.',
        getComponentName(workInProgress.type) || 'Component',
      );
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

function callComponentWillReceiveProps(
  workInProgress,
  instance,
  newProps,
  nextContext,
) {
  const oldState = instance.state;
  startPhaseTimer(workInProgress, 'componentWillReceiveProps');
  if (typeof instance.componentWillReceiveProps === 'function') {
    instance.componentWillReceiveProps(newProps, nextContext);
  }
  if (typeof instance.UNSAFE_componentWillReceiveProps === 'function') {
    instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
  }
  stopPhaseTimer();

  if (instance.state !== oldState) {
    //删除了 dev 代码
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

// Invokes the mount life-cycles on a previously never rendered instance.
//在未 render 的 class 实例上调用挂载生命周期
function mountClassInstance(
  workInProgress: Fiber,
  ctor: any,
  //nextProps,待更新的 props
  newProps: any,
  renderExpirationTime: ExpirationTime,
): void {
  if (__DEV__) {
    checkClassInstance(workInProgress, ctor, newProps);
  }
  //更新 props/state
  const instance = workInProgress.stateNode;
  instance.props = newProps;
  instance.state = workInProgress.memoizedState;
  instance.refs = emptyRefsObject;
  //=========context 相关，可跳过==================================
  const contextType = ctor.contextType;
  if (typeof contextType === 'object' && contextType !== null) {
    instance.context = readContext(contextType);
  } else {
    const unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    instance.context = getMaskedContext(workInProgress, unmaskedContext);
  }
  //=============================================

  //删除了 dev 分支


  let updateQueue = workInProgress.updateQueue;
  //执行更新 update队列
  if (updateQueue !== null) {
    //里面还更新了 state
    processUpdateQueue(
      workInProgress,
      updateQueue,
      newProps,
      instance,
      renderExpirationTime,
    );
    //因为 state 更新了，所以instance的state也要更新
    instance.state = workInProgress.memoizedState;
  }
  //getDerivedStateFromProps是 React 新的生命周期的方法
  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    instance.state = workInProgress.memoizedState;
  }

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  //判断是否要调用 componentWillMount
  //第一次渲染的话，是要调用componentWillMount的
  if (
    typeof ctor.getDerivedStateFromProps !== 'function' &&
    typeof instance.getSnapshotBeforeUpdate !== 'function' &&
    (typeof instance.UNSAFE_componentWillMount === 'function' ||
      typeof instance.componentWillMount === 'function')
  ) {
    callComponentWillMount(workInProgress, instance);
    // If we had additional state updates during this life-cycle, let's
    // process them now.
    //在ComponentWillMount中是有可能执行 setState 的，
    // 所以 React 也要及时更新state 并更新到instance上
    updateQueue = workInProgress.updateQueue;
    if (updateQueue !== null) {
      processUpdateQueue(
        workInProgress,
        updateQueue,
        newProps,
        instance,
        renderExpirationTime,
      );
      instance.state = workInProgress.memoizedState;
    }
  }
  //等到真正渲染到 DOM 上去的时候，再去调用componentDidMount
  if (typeof instance.componentDidMount === 'function') {
    workInProgress.effectTag |= Update;
  }
}
//复用 class 实例，更新 props/state，调用生命周期，返回 shouldUpdate
function resumeMountClassInstance(
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderExpirationTime: ExpirationTime,
): boolean {
  //获取 ClassComponent 实例
  const instance = workInProgress.stateNode;
  //获取已有的 props
  const oldProps = workInProgress.memoizedProps;
  //初始化 类实例 的 props
  instance.props = oldProps;
  //=====可跳过 context 相关代码====================================================
  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext;
  if (typeof contextType === 'object' && contextType !== null) {
    nextContext = readContext(contextType);
  } else {
    const nextLegacyUnmaskedContext = getUnmaskedContext(
      workInProgress,
      ctor,
      true,
    );
    nextContext = getMaskedContext(workInProgress, nextLegacyUnmaskedContext);
  }
  //============================================================================

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  //从开发角度上看，只要有调用getDerivedStateFromProps()或getSnapshotBeforeUpdate()
  //其中一个生命周期API，变量 hasNewLifecycles 就为 true
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  //如果没有用新的生命周期的方法，则执行componentWillReceiveProps()
  //也就是说，如果有getDerivedStateFromProps()或getSnapshotBeforeUpdate()，就不调用componentWillReceiveProps方法了
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (oldProps !== newProps || oldContext !== nextContext) {
      callComponentWillReceiveProps(
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }
  //设置 hasForceUpdate 为 false
  resetHasForceUpdateBeforeProcessing();
  //====更新 updateQueue，获取新 state，与mountClassInstance中的callComponentWillMount的下面逻辑相同，不再赘述================================

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  let updateQueue = workInProgress.updateQueue;
  if (updateQueue !== null) {
    processUpdateQueue(
      workInProgress,
      updateQueue,
      newProps,
      instance,
      renderExpirationTime,
    );
    newState = workInProgress.memoizedState;
  }
  //====================================
  //如果新老 props 和 state 没有差别，并且没有 forceupdate 的情况，
  //那么组件就不更新
  if (
    oldProps === newProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing()
  ) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    //由于current为 null，即第一次渲染，需要调用componentDidMount()
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.effectTag |= Update;
    }
    //即 shouldUpdate 为 false
    return false;
  }
  //有调用getDerivedStateFromProps()的话，则执行对应的applyDerivedStateFromProps
  //componentWillReceiveProps()与「getDerivedStateFromProps()/getSnapshotBeforeUpdate()」是互斥关系
  //这边能执行，说明componentWillReceiveProps()就不执行
  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState;
  }
  //检查是否有 forceUpdate 和新老 props/state 的更新
  //只有当既没有 forceUpdate 又没有 props/state 的改变，shouldUpdate才会为 false
  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    );
  //当有更新的时候，执行相应的生命周期方法——componentWillMount()和componentDidMount()
  if (shouldUpdate) {
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillMount === 'function' ||
        typeof instance.componentWillMount === 'function')
    ) {
      startPhaseTimer(workInProgress, 'componentWillMount');
      if (typeof instance.componentWillMount === 'function') {
        instance.componentWillMount();
      }
      if (typeof instance.UNSAFE_componentWillMount === 'function') {
        instance.UNSAFE_componentWillMount();
      }
      stopPhaseTimer();
    }
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.effectTag |= Update;
    }
  } else {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    //有一个疑问——为什么不需要 update，还要执行componentDidMount方法来更新？
    //没明白注释写的cWU/cDU是啥意思
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.effectTag |= Update;
    }

    // If shouldComponentUpdate returned false, we should still update the
    // memoized state to indicate that this work can be reused.
    //即使不需要 update，也会更新原有的 props/state,以保证复用
    //也没明白为啥
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  //更新相关属性为最新的 props/state，无论是否有 update
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;
  //boolean
  return shouldUpdate;
}

// Invokes the update life-cycles and returns false if it shouldn't rerender.
function updateClassInstance(
  current: Fiber,
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderExpirationTime: ExpirationTime,
): boolean {
  const instance = workInProgress.stateNode;

  const oldProps = workInProgress.memoizedProps;
  instance.props =
    workInProgress.type === workInProgress.elementType
      ? oldProps
      : resolveDefaultProps(workInProgress.type, oldProps);

  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext;
  if (typeof contextType === 'object' && contextType !== null) {
    nextContext = readContext(contextType);
  } else {
    const nextUnmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    nextContext = getMaskedContext(workInProgress, nextUnmaskedContext);
  }

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (oldProps !== newProps || oldContext !== nextContext) {
      callComponentWillReceiveProps(
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }

  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  let updateQueue = workInProgress.updateQueue;
  if (updateQueue !== null) {
    processUpdateQueue(
      workInProgress,
      updateQueue,
      newProps,
      instance,
      renderExpirationTime,
    );
    newState = workInProgress.memoizedState;
  }

  if (
    oldProps === newProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing()
  ) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.

    //注意这里与 resumeMountClassInstance() 不一样
    //updateClassInstance()：componentDidUpdate/getSnapshotBeforeUpdate
    //resumeMountClassInstance()：componentDidMount
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        oldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.effectTag |= Update;
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        oldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.effectTag |= Snapshot;
      }
    }
    return false;
  }

  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState;
  }

  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    );

  if (shouldUpdate) {
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    //此处也与resumeMountClassInstance() 不同
    //updateClassInstance()：componentWillUpdate/componentDidUpdate/getSnapshotBeforeUpdate
    //resumeMountClassInstance()：componentWillMount/componentDidMount
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillUpdate === 'function' ||
        typeof instance.componentWillUpdate === 'function')
    ) {
      startPhaseTimer(workInProgress, 'componentWillUpdate');
      if (typeof instance.componentWillUpdate === 'function') {
        instance.componentWillUpdate(newProps, newState, nextContext);
      }
      if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
        instance.UNSAFE_componentWillUpdate(newProps, newState, nextContext);
      }
      stopPhaseTimer();
    }
    if (typeof instance.componentDidUpdate === 'function') {
      workInProgress.effectTag |= Update;
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      workInProgress.effectTag |= Snapshot;
    }
  } else {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        oldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.effectTag |= Update;
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        oldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.effectTag |= Snapshot;
      }
    }

    // If shouldComponentUpdate returned false, we should still update the
    // memoized props/state to indicate that this work can be reused.
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  return shouldUpdate;
}

export {
  adoptClassInstance,
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
};
