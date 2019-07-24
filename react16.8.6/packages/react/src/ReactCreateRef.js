/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 * @flow
 */

import type {RefObject} from 'shared/ReactTypes';

// an immutable object with a single mutable value
//可修改value的 不可变的对象
//没见过这种写法 :RefObject
export function createRef(): RefObject {
  //初始化ref对象，属性current初始值为null
  const refObject = {
    current: null,
  };
  if (__DEV__) {
    //密封的对象,不可添加，删除属性，可以修改属性
    Object.seal(refObject);
  }
  return refObject;
}
