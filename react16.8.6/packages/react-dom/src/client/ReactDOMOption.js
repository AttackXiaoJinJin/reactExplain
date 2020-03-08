/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import React from 'react';
import warning from 'shared/warning';
import {getToStringValue, toString} from './ToStringValue';

let didWarnSelectedSetOnOption = false;
let didWarnInvalidChild = false;
//展平 children
//可参考：https://www.jianshu.com/p/55626eb8f645
function flattenChildren(children) {
  let content = '';

  // Flatten children. We'll warn if they are invalid
  // during validateProps() which runs for hydration too.
  // Note that this would throw on non-element objects.
  // Elements are stringified (which is normally irrelevant
  // but matters for <fbt>).
  React.Children.forEach(children, function(child) {
    if (child == null) {
      return;
    }
    content += child;
    // Note: we don't warn about invalid children here.
    // Instead, this is done separately below so that
    // it happens during the hydration codepath too.
  });

  return content;
}

/**
 * Implements an <option> host component that warns when `selected` is set.
 */
//dev 环境下
//1、判断<option>标签的子节点是否是 number/string
//2、判断是否正确设置defaultValue/value
export function validateProps(element: Element, props: Object) {
  if (__DEV__) {
    // This mirrors the codepath above, but runs for hydration too.
    // Warn about invalid children here so that client and hydration are consistent.
    // TODO: this seems like it could cause a DEV-only throw for hydration
    // if children contains a non-element object. We should try to avoid that.
    if (typeof props.children === 'object' && props.children !== null) {
      React.Children.forEach(props.children, function(child) {
        if (child == null) {
          return;
        }
        if (typeof child === 'string' || typeof child === 'number') {
          return;
        }
        if (typeof child.type !== 'string') {
          return;
        }
        if (!didWarnInvalidChild) {
          didWarnInvalidChild = true;
          warning(
            false,
            'Only strings and numbers are supported as <option> children.',
          );
        }
      });
    }

    // TODO: Remove support for `selected` in <option>.
    if (props.selected != null && !didWarnSelectedSetOnOption) {
      warning(
        false,
        'Use the `defaultValue` or `value` props on <select> instead of ' +
          'setting `selected` on <option>.',
      );
      didWarnSelectedSetOnOption = true;
    }
  }
}

export function postMountWrapper(element: Element, props: Object) {
  // value="" should make a value attribute (#6219)
  if (props.value != null) {
    element.setAttribute('value', toString(getToStringValue(props.value)));
  }
}

//获取<option>child 的内容，并且展平 children
export function getHostProps(element: Element, props: Object) {
  const hostProps = {children: undefined, ...props};
  //展平 child，可参考我之前写的一篇：https://juejin.im/post/5d46b71a6fb9a06b0c084acd
  const content = flattenChildren(props.children);

  if (content) {
    hostProps.children = content;
  }

  return hostProps;
}
