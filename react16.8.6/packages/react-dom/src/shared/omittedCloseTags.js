/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// For HTML, certain tags should omit their close tag. We keep a whitelist for
// those special-case tags.
  //列举了不能有子标签的 html 标签的集合，<menuitem>除外
const omittedCloseTags = {
  //<area />
  area: true,
  //<base />
  base: true,
  //<br />
  br: true,
  //<col />
  col: true,
  //<embed />
  embed: true,
  //<hr />
  hr: true,
  //<img />
  img: true,
  //<input />
  input: true,
  //<keygen />
  keygen: true,
  //<link />
  link: true,
  //<meta />
  meta: true,
  //<param />
  param: true,
  //<source />
  source: true,
  //<track />
  track: true,
  //<wbr />
  wbr: true,
  // NOTE: menuitem's close tag should be omitted, but that causes problems.
  //<menuitem>除外
};

export default omittedCloseTags;
