/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import omittedCloseTags from './omittedCloseTags';

// For HTML, certain tags cannot have children. This has the same purpose as
// `omittedCloseTags` except that `menuitem` should still have its closing tag.
//有些 html 标签是不能有子节点的,比如空标签<br/>、<input/>
//<menuitem>除外

const voidElementTags = {
  menuitem: true,
  ...omittedCloseTags,
};

export default voidElementTags;
