/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import invariant from 'shared/invariant';
import lowPriorityWarning from 'shared/lowPriorityWarning';

import ReactNoopUpdateQueue from './ReactNoopUpdateQueue';

const emptyObject = {};
if (__DEV__) {
  Object.freeze(emptyObject);
}

/**
 * Base class helpers for the updating state of a component.
 */
//帮助更新组件状态的基类
function Component(props, context, updater) {
  this.props = props;
  //我在工作中没用到context，可以参考下这个：
  //https://www.cnblogs.com/mengff/p/9511419.html
  //是React封装的全局变量API
  this.context = context;
  // If a component has string refs, we will assign a different object later.
  //如果在组件中用了 ref="stringa" 的话，用另一个obj赋值
  this.refs = emptyObject;
  // We initialize the default updater but the real one gets injected by the
  // renderer.
  //虽然给updater赋了默认值，但真正的updater是在renderer中注册的
  this.updater = updater || ReactNoopUpdateQueue;
}
//原型上赋了一个flag
/*这也是为什么要继承 Component 的原因，因为 React要根据这个来判断是否是 React 组件*/
Component.prototype.isReactComponent = {};

/** 使用setState来改变Component内部的变量

 * Sets a subset of the state. Always use this to mutate
 * state. You should treat `this.state` as immutable.

 * this.state并不是立即更新的，所以在调用this.setState后可能 不能 拿到新值

 * There is no guarantee that `this.state` will be immediately updated, so
 * accessing `this.state` after calling this method may return the old value.
 *
 * 不能保证this.state是同步的（它也不是异步的），使用回调获取最新值
 *
 * There is no guarantee that calls to `setState` will run synchronously,
 * as they may eventually be batched together.  You can provide an optional
 * callback that will be executed when the call to setState is actually
 * completed.
 *
 * When a function is provided to setState, it will be called at some point in
 * the future (not synchronously). It will be called with the up to date
 * component arguments (state, props, context). These values can be different
 * from this.* because your function may be called after receiveProps but before
 * shouldComponentUpdate, and this new state, props, and context will not yet be
 * assigned to this.
 *
 * @param {object|function} partialState Next partial state or function to
 *        produce next partial state to be merged with current state.
 * @param {?function} callback Called after state is updated.
 * @final
 * @protected
 */


// 更新Component内部变量的API，
// 也是开发中非常常用且重要的API

// https://www.jianshu.com/p/7ab07f8c954c
// https://www.jianshu.com/p/c19e259870a5

//partialState：要更新的state，可以是Object/Function
//callback： setState({xxx},callback)
Component.prototype.setState = function(partialState, callback) {
  // 判断setState中的partialState是否符合条件，
  // 如果不符合则抛出Error
  invariant(
    typeof partialState === 'object' ||
      typeof partialState === 'function' ||
      partialState == null,
    'setState(...): takes an object of state variables to update or a ' +
      'function which returns an object of state variables.',
  );
  //重要！state的更新机制
  //在react-dom中实现，不在react中实现
  this.updater.enqueueSetState(this, partialState, callback, 'setState');
};

/**
 * Forces an update. This should only be invoked when it is known with
 * certainty that we are **not** in a DOM transaction.
 *
 * 在Component的深层次改变但未调用setState时，使用该方法
 *
 * You may want to call this when you know that some deeper aspect of the
 * component's state has changed but `setState` was not called.
 *
 * forceUpdate不调用shouldComponentUpdate方法，
 * 但会调用componentWillUpdate和componentDidUpdate方法
 *
 * This will not invoke `shouldComponentUpdate`, but it will invoke
 * `componentWillUpdate` and `componentDidUpdate`.
 *
 * @param {?function} callback Called after update is complete.
 * @final
 * @protected
 */
//强制Component更新一次，无论props/state是否更新
Component.prototype.forceUpdate = function(callback) {
  this.updater.enqueueForceUpdate(this, callback, 'forceUpdate');
};

/**
 * Deprecated APIs. These APIs used to exist on classic React classes but since
 * we would like to deprecate them, we're not going to move them over to this
 * modern base class. Instead, we define a getter that warns if it's accessed.
 */
//两个废弃的API，可不看
if (__DEV__) {

  const deprecatedAPIs = {
    isMounted: [
      'isMounted',
      'Instead, make sure to clean up subscriptions and pending requests in ' +
        'componentWillUnmount to prevent memory leaks.',
    ],
    replaceState: [
      'replaceState',
      'Refactor your code to use setState instead (see ' +
        'https://github.com/facebook/react/issues/3236).',
    ],
  };
  const defineDeprecationWarning = function(methodName, info) {
    Object.defineProperty(Component.prototype, methodName, {
      get: function() {
        lowPriorityWarning(
          false,
          '%s(...) is deprecated in plain JavaScript React classes. %s',
          info[0],
          info[1],
        );
        return undefined;
      },
    });
  };
  for (const fnName in deprecatedAPIs) {
    if (deprecatedAPIs.hasOwnProperty(fnName)) {
      defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
    }
  }
}

function ComponentDummy() {}

//ComponentDummy的原型 继承 Component的原型
ComponentDummy.prototype = Component.prototype;

/**
 * Convenience component with default shallow equality check for sCU.
 */


function PureComponent(props, context, updater) {
  this.props = props;
  this.context = context;
  // If a component has string refs, we will assign a different object later.
  this.refs = emptyObject;
  this.updater = updater || ReactNoopUpdateQueue;
}

//PureComponent是继承自Component的,下面三行就是在继承Component

//将Component的方法拷贝到pureComponentPrototype上
// 用ComponentDummy的原因是为了不直接实例化一个Component实例，可以减少一些内存使用
const pureComponentPrototype = (PureComponent.prototype = new ComponentDummy());

//PureComponent.prototype.constructor = PureComponent
pureComponentPrototype.constructor = PureComponent;

// Avoid an extra prototype jump for these methods.
//避免多一次原型链查找,因为上面两句已经让PureComponent继承了Component
//下面多写了一句Object.assign()，是为了避免多一次原型链查找

// Object.assign是浅拷贝，
// 将Component.prototype上的方法都复制到PureComponent.prototype上
// 也就是pureComponent的原型上
// 详细请参考：https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Object/assign
Object.assign(pureComponentPrototype, Component.prototype);

// 唯一的区别就是在原型上添加了isPureReactComponent属性去表示该Component是PureComponent
pureComponentPrototype.isPureReactComponent = true;

export {Component, PureComponent};
