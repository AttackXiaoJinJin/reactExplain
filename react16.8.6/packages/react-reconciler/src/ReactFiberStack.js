/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';

import warningWithoutStack from 'shared/warningWithoutStack';

export type StackCursor<T> = {
  current: T,
};

const valueStack: Array<any> = [];

let fiberStack: Array<Fiber | null>;

if (__DEV__) {
  fiberStack = [];
}

let index = -1;

function createCursor<T>(defaultValue: T): StackCursor<T> {
  return {
    current: defaultValue,
  };
}

function isEmpty(): boolean {
  return index === -1;
}
//从后往前，将栈 valueStack 内的元素出栈赋值
function pop<T>(cursor: StackCursor<T>, fiber: Fiber): void {
  if (index < 0) {
    //删除了 dev 代码

    return;
  }

  //删除了 dev 代码

  //将栈中指定位置的 value 赋值给 cursor.current
  cursor.current = valueStack[index];
  //置 null
  valueStack[index] = null;

  //删除了 dev 代码

  //出栈，从后往前
  index--;
}

function push<T>(cursor: StackCursor<T>, value: T, fiber: Fiber): void {
  index++;

  valueStack[index] = cursor.current;

  if (__DEV__) {
    fiberStack[index] = fiber;
  }

  cursor.current = value;
}

function checkThatStackIsEmpty() {
  if (__DEV__) {
    if (index !== -1) {
      warningWithoutStack(
        false,
        'Expected an empty stack. Something was not reset properly.',
      );
    }
  }
}

function resetStackAfterFatalErrorInDev() {
  if (__DEV__) {
    index = -1;
    valueStack.length = 0;
    fiberStack.length = 0;
  }
}

export {
  createCursor,
  isEmpty,
  pop,
  push,
  // DEV only:
  checkThatStackIsEmpty,
  resetStackAfterFatalErrorInDev,
};
