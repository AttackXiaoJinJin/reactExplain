/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import invariant from 'shared/invariant';
import warning from 'shared/warning';
import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_PORTAL_TYPE,
} from 'shared/ReactSymbols';

import {isValidElement, cloneAndReplaceKey} from './ReactElement';
import ReactDebugCurrentFrame from './ReactDebugCurrentFrame';

const SEPARATOR = '.';
const SUBSEPARATOR = ':';

/**
 * Escape and wrap key so it is safe to use as a reactid
 *
 * @param {string} key to be escaped.
 * @return {string} the escaped key.
 */
function escape(key) {
  const escapeRegex = /[=:]/g;
  const escaperLookup = {
    '=': '=0',
    ':': '=2',
  };
  const escapedString = ('' + key).replace(escapeRegex, function(match) {
    return escaperLookup[match];
  });
  //从=转到$=0
  return '$' + escapedString;
}

/**
 * TODO: Test that a single child and an array with one item have the same key
 * pattern.
 */

let didWarnAboutMaps = false;

const userProvidedKeyEscapeRegex = /\/+/g;
function escapeUserProvidedKey(text) {
  //如果字符串中有连续多个 / 的话，在匹配的字串后再加 /
  return ('' + text).replace(userProvidedKeyEscapeRegex, '$&/');
}
//对象池的最大容量为10
const POOL_SIZE = 10;
//对象池
const traverseContextPool = [];
//[],'',(item)=>{return [item,[item,] ]},undefined
function getPooledTraverseContext(
  mapResult,
  keyPrefix,
  mapFunction,
  mapContext,
) {
  //如果对象池内存在对象，则出队一个对象，
  //并将arguments的值赋给对象属性
  //最后返回该对象
  if (traverseContextPool.length) {
    const traverseContext = traverseContextPool.pop();
    traverseContext.result = mapResult;
    traverseContext.keyPrefix = keyPrefix;
    traverseContext.func = mapFunction;
    traverseContext.context = mapContext;
    traverseContext.count = 0;
    return traverseContext;
  }
  //如果不存在，则返回一个新对象
  else {
    //{
    // result:[],
    // keyPrefix:'',
    // func:(item)=>{return [item,[item,] ]},
    // context:undefined,
    // count:0,
    // }
    return {
      result: mapResult,
      keyPrefix: keyPrefix,
      func: mapFunction,
      context: mapContext,
      count: 0,
    };
  }
}
//当递归结束后，释放traverseContext属性
function releaseTraverseContext(traverseContext) {
  traverseContext.result = null;
  traverseContext.keyPrefix = null;
  traverseContext.func = null;
  traverseContext.context = null;
  traverseContext.count = 0;
  //
  if (traverseContextPool.length < POOL_SIZE) {
    traverseContextPool.push(traverseContext);
  }
}

/**
 * @param {?*} children Children tree container.
 * @param {!string} nameSoFar Name of the key path so far.
 * @param {!function} callback Callback to invoke with each child found.
 * @param {?*} traverseContext Used to pass information throughout the traversal
 * process.
 * @return {!number} The number of children in this subtree.
 */
// children, '', mapSingleChildIntoContext, traverseContext
function traverseAllChildrenImpl(
  children,
  nameSoFar,
  callback,
  //traverseContext=
  // {
  //  result:[],
  //  keyPrefix:'',
  //  func:(item)=>{return [item,[item,] ]},
  //  context:undefined,
  //  count:0,
  // }
  traverseContext,
) {
  const type = typeof children;

  if (type === 'undefined' || type === 'boolean') {
    //以上所有的被认为是null
    // All of the above are perceived as null.
    children = null;
  }
  //调用func的flag
  let invokeCallback = false;

  if (children === null) {
    invokeCallback = true;
  } else {
    switch (type) {
      case 'string':
      case 'number':
        invokeCallback = true;
        break;
      case 'object':
        //如果props.children是单个ReactElement/PortalElement的话
        //递归traverseAllChildrenImpl时，<span>1<span/>和<span>2<span/>作为child
        //必会触发invokeCallback=true
        switch (children.$$typeof) {
          case REACT_ELEMENT_TYPE:
          case REACT_PORTAL_TYPE:
            invokeCallback = true;
        }
    }
  }

  if (invokeCallback) {
    callback(
      traverseContext,
      children,
      //如果只有一个子节点，也将它放在数组中来处理
      // If it's the only child, treat the name as if it was wrapped in an array
      // so that it's consistent if the number of children grows.
      //.$=0

      //<span>1<span/> key='.0'
      nameSoFar === '' ? SEPARATOR + getComponentKey(children, 0) : nameSoFar,
    );
    return 1;
  }

  let child;
  let nextName;
  //有多少个子节点
  let subtreeCount = 0; // Count of children found in the current subtree.
  const nextNamePrefix =
    //.
    nameSoFar === '' ? SEPARATOR : nameSoFar + SUBSEPARATOR;

  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      //<span>1</span>
      child = children[i];
      //不手动设置key的话第一层第一个是.0，第二个是.1
      nextName = nextNamePrefix + getComponentKey(child, i);

      subtreeCount += traverseAllChildrenImpl(
        child,
        nextName,
        callback,
        traverseContext,
      );
    }
  } else {
    const iteratorFn = getIteratorFn(children);
    if (typeof iteratorFn === 'function') {
      if (__DEV__) {
        // Warn about using Maps as children
        if (iteratorFn === children.entries) {
          warning(
            didWarnAboutMaps,
            'Using Maps as children is unsupported and will likely yield ' +
              'unexpected results. Convert it to a sequence/iterable of keyed ' +
              'ReactElements instead.',
          );
          didWarnAboutMaps = true;
        }
      }

      const iterator = iteratorFn.call(children);
      let step;
      let ii = 0;
      while (!(step = iterator.next()).done) {
        child = step.value;
        nextName = nextNamePrefix + getComponentKey(child, ii++);
        subtreeCount += traverseAllChildrenImpl(
          child,
          nextName,
          callback,
          traverseContext,
        );
      }
    }
    //如果是一个纯对象的话，throw error
    else if (type === 'object') {
      let addendum = '';
      if (__DEV__) {
        addendum =
          ' If you meant to render a collection of children, use an array ' +
          'instead.' +
          ReactDebugCurrentFrame.getStackAddendum();
      }
      const childrenString = '' + children;
      invariant(
        false,
        'Objects are not valid as a React child (found: %s).%s',
        childrenString === '[object Object]'
          ? 'object with keys {' + Object.keys(children).join(', ') + '}'
          : childrenString,
        addendum,
      );
    }
  }

  return subtreeCount;
}

/**
 * Traverses children that are typically specified as `props.children`, but
 * might also be specified through attributes:
 *
 * - `traverseAllChildren(this.props.children, ...)`
 * - `traverseAllChildren(this.props.leftPanelChildren, ...)`
 *
 * The `traverseContext` is an optional argument that is passed through the
 * entire traversal. It can be used to store accumulations or anything else that
 * the callback might find relevant.
 *
 * @param {?*} children Children tree object.
 * @param {!function} callback To invoke upon traversing each child.
 * @param {?*} traverseContext Context for traversal.
 * @return {!number} The number of children in this subtree.
 */
// children, mapSingleChildIntoContext, traverseContext
function traverseAllChildren(children, callback, traverseContext) {
  if (children == null) {
    return 0;
  }

  return traverseAllChildrenImpl(children, '', callback, traverseContext);
}

/**
 * Generate a key string that identifies a component within a set.
 *
 * @param {*} component A component that could contain a manual key.
 * @param {number} index Index that is used if a manual key is not provided.
 * @return {string}
 */
//children,0
function getComponentKey(component, index) {
  // Do some typechecking here since we call this blindly. We want to ensure
  // that we don't block potential future ES APIs.
  //如果component是单个有key的节点的话
  if (
    typeof component === 'object' &&
    component !== null &&
    component.key != null
  ) {
    // Explicit key
    return escape(component.key);
  }
  // Implicit key determined by the index in the set
  return index.toString(36);
}

function forEachSingleChild(bookKeeping, child, name) {
  const {func, context} = bookKeeping;
  func.call(context, child, bookKeeping.count++);
}

/**
 * Iterates through children that are typically specified as `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenforeach
 *
 * The provided forEachFunc(child, index) will be called for each
 * leaf child.
 *
 * @param {?*} children Children tree container.
 * @param {function(*, int)} forEachFunc
 * @param {*} forEachContext Context for forEachContext.
 */
function forEachChildren(children, forEachFunc, forEachContext) {
  if (children == null) {
    return children;
  }
  const traverseContext = getPooledTraverseContext(
    null,
    null,
    forEachFunc,
    forEachContext,
  );
  traverseAllChildren(children, forEachSingleChild, traverseContext);
  releaseTraverseContext(traverseContext);
}
//bookKeeping:traverseContext=
// {
//  result:[],
//  keyPrefix:'',
//  func:(item)=>{return [item,[item,] ]},
//  context:undefined,
//  count:0,
// }

//child:<span>1<span/>

//childKey:.0
function mapSingleChildIntoContext(bookKeeping, child, childKey) {
  //解构赋值
  const {result, keyPrefix, func, context} = bookKeeping;
  //func:(item)=>{return [item,[item,] ]},
  //item即<span>1<span/>
  //第二个参数bookKeeping.count++很有意思，压根儿没用到，但仍起到计数的作用
  let mappedChild = func.call(context, child, bookKeeping.count++);
  //如果根据React.Children.map()第二个参数callback，执行仍是一个数组的话，
  //递归调用mapIntoWithKeyPrefixInternal，继续之前的步骤，
  //直到是单个ReactElement
  if (Array.isArray(mappedChild)) {
    //mappedChild:[item,[item,] ]
    //result:[]
    //childKey:.0
    //func:c => c
    mapIntoWithKeyPrefixInternal(mappedChild, result, childKey, c => c);
  }
  //当mappedChild是单个ReactElement并且不为null的时候
  else if (mappedChild != null) {
    if (isValidElement(mappedChild)) {
      //赋给新对象除key外同样的属性，替换key属性
      mappedChild = cloneAndReplaceKey(
        mappedChild,
        // Keep both the (mapped) and old keys if they differ, just as
        // traverseAllChildren used to do for objects as children
        //如果新老keys是不一样的话，两者都保留，像traverseAllChildren对待objects做的那样
        keyPrefix +
          (mappedChild.key && (!child || child.key !== mappedChild.key)
            ? escapeUserProvidedKey(mappedChild.key) + '/'
            : '') +
          childKey,
      );
    }
    //result即map时，return的result
    result.push(mappedChild);
  }
}
//第一次：props.children , [] , null , (item)=>{return [item,[item,] ]} , undefined
//第二次：[item,[item,] ] , [] , .0 , c => c , undefined
function mapIntoWithKeyPrefixInternal(children, array, prefix, func, context) {
  let escapedPrefix = '';
  //如果字符串中有连续多个 / 的话，在匹配的字串后再加 /
  if (prefix != null) {
    escapedPrefix = escapeUserProvidedKey(prefix) + '/';
  }
  //从pool中找一个对象
  //[],'',(item)=>{return [item,[item,] ]},undefined

  //traverseContext=
  // {
  //  result:[],
  //  keyPrefix:'',
  //  func:(item)=>{return [item,[item,] ]},
  //  context:undefined,
  //  count:0,
  // }
  const traverseContext = getPooledTraverseContext(
    array,
    escapedPrefix,
    func,
    context,
  );
  //将嵌套的数组展平
  traverseAllChildren(children, mapSingleChildIntoContext, traverseContext);
  releaseTraverseContext(traverseContext);
}

/**
 * Maps children that are typically specified as `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenmap
 *
 * The provided mapFunction(child, key, index) will be called for each
 * leaf child.
 *
 * @param {?*} children Children tree container.
 * @param {function(*, int)} func The map function.
 * @param {*} context Context for mapFunction.
 * @return {object} Object containing the ordered map of results.
 */
// React.Children.map(props.children,item=>[item,[item,] ])
function mapChildren(children, func, context) {
  if (children == null) {
    return children;
  }
  const result = [];
  //进行基本的判断和初始化后，调用该方法
  //props.children,[],null,(item)=>{return [item,[item,] ]},undefined
  mapIntoWithKeyPrefixInternal(children, result, null, func, context);
  return result;
}

/**
 * Count the number of children that are typically specified as
 * `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrencount
 *
 * @param {?*} children Children tree container.
 * @return {number} The number of children.
 */
function countChildren(children) {
  return traverseAllChildren(children, () => null, null);
}

/**
 * Flatten a children object (typically specified as `props.children`) and
 * return an array with appropriately re-keyed children.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrentoarray
 */
function toArray(children) {
  const result = [];
  mapIntoWithKeyPrefixInternal(children, result, null, child => child);
  return result;
}

/**
 * Returns the first child in a collection of children and verifies that there
 * is only one child in the collection.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenonly
 *
 * The current implementation of this function assumes that a single child gets
 * passed without a wrapper, but the purpose of this helper function is to
 * abstract away the particular structure of children.
 *
 * @param {?object} children Child collection structure.
 * @return {ReactElement} The first and only `ReactElement` contained in the
 * structure.
 */
function onlyChild(children) {
  invariant(
    isValidElement(children),
    'React.Children.only expected to receive a single React element child.',
  );
  return children;
}

export {
  //as就是重命名了，map即mapChildren
  forEachChildren as forEach,
  mapChildren as map,
  countChildren as count,
  onlyChild as only,
  toArray,
};
