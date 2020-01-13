/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import is from './objectIs';

const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Performs equality by iterating through keys on an object and returning false
 * when any key has values which are not strictly equal between the arguments.
 * Returns true when the values of all keys are strictly equal.
 */
//true 为不要更新
//false 为要更新
function shallowEqual(objA: mixed, objB: mixed): boolean {
  //同 Object.js()
  //https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is#Description
  //不要更新
  if (is(objA, objB)) {
    return true;
  }
  //只要有一个不是 object或为 null 则返回 false，要更新
  if (
    typeof objA !== 'object' ||
    objA === null ||
    typeof objB !== 'object' ||
    objB === null
  ) {
    return false;
  }

  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  //两个 object 的key 数不一样，则返回 false，要更新
  if (keysA.length !== keysB.length) {
    return false;
  }

  // Test for A's keys different from B.
  //每一个 value 去一一比较是否是浅相等
  //能执行到这里，说明两者 key 的长度是相等的
  for (let i = 0; i < keysA.length; i++) {
    if (
      //不通过原型链查找是否有自己的属性
      !hasOwnProperty.call(objB, keysA[i]) ||
      //判断两值是否相等
      !is(objA[keysA[i]], objB[keysA[i]])
    ) {
      //只要没有属性/两个value不等，则返回 false，需要更新
      return false;
    }
  }
  //默认返回 true，不需要更新
  return true;
}

export default shallowEqual;
