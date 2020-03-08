/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

//判断是否是自定义的 DOM 标签
function isCustomComponent(tagName: string, props: Object) {
  //一般自定义标签的命名规则是带`-`的
  if (tagName.indexOf('-') === -1) {
    //https://developer.mozilla.org/zh-CN/docs/Web/HTML/Global_attributes/is
    return typeof props.is === 'string';
  }
  //以下的是SVG/MathML的标签属性
  switch (tagName) {
    // These are reserved SVG and MathML elements.
    // We don't mind this whitelist too much because we expect it to never grow.
    // The alternative is to track the namespace in a few places which is convoluted.
    // https://w3c.github.io/webcomponents/spec/custom/#custom-elements-core-concepts
    case 'annotation-xml':
    case 'color-profile':
    case 'font-face':
    case 'font-face-src':
    case 'font-face-uri':
    case 'font-face-format':
    case 'font-face-name':
    case 'missing-glyph':
      return false;
    default:
      return true;
  }
}

export default isCustomComponent;
