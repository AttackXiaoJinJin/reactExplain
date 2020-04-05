/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {TEXT_NODE} from '../shared/HTMLNodeType';

/**
 * Set the textContent property of a node. For text updates, it's faster
 * to set the `nodeValue` of the Text node directly instead of using
 * `.textContent` which will remove the existing node and create a new one.
 *
 * @param {DOMElement} node
 * @param {string} text
 * @internal
 */
//给 DOM 节点设置text
let setTextContent = function(node: Element, text: string): void {
  if (text) {
    let firstChild = node.firstChild;
    //如果只有一个子节点且是文字节点，将其value置为 text
    if (
      firstChild &&
      firstChild === node.lastChild &&
      firstChild.nodeType === TEXT_NODE
    ) {
      firstChild.nodeValue = text;
      return;
    }
  }
  //text 为''，则直接执行这一步
  node.textContent = text;
};

export default setTextContent;
