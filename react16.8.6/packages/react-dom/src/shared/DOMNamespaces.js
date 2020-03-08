/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const MATH_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

//注意 svg/mathml 的命名空间是与 html 不相同的
export const Namespaces = {
  html: HTML_NAMESPACE, // http://www.w3.org/1999/xhtml
  mathml: MATH_NAMESPACE,// http://www.w3.org/1998/Math/MathML
  svg: SVG_NAMESPACE,// http://www.w3.org/2000/svg
};

// Assumes there is no parent namespace.
//假设没有父命名空间
//根据 DOM 实例的标签获取相应的命名空间
export function getIntrinsicNamespace(type: string): string {
  switch (type) {
    case 'svg':
      return SVG_NAMESPACE;
    case 'math':
      return MATH_NAMESPACE;
    default:
      return HTML_NAMESPACE;
  }
}

export function getChildNamespace(
  parentNamespace: string | null,
  type: string,
): string {
  if (parentNamespace == null || parentNamespace === HTML_NAMESPACE) {
    // No (or default) parent namespace: potential entry point.
    return getIntrinsicNamespace(type);
  }
  if (parentNamespace === SVG_NAMESPACE && type === 'foreignObject') {
    // We're leaving SVG.
    return HTML_NAMESPACE;
  }
  // By default, pass namespace below.
  return parentNamespace;
}
