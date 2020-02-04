/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {REACT_FORWARD_REF_TYPE, REACT_MEMO_TYPE} from 'shared/ReactSymbols';

import warningWithoutStack from 'shared/warningWithoutStack';

export default function forwardRef<Props, ElementType: React$ElementType>(
  render: (props: Props, ref: React$Ref<ElementType>) => React$Node,
) {
  //删除了 dev 代码

  return {
    //被forwardRef包裹后，组件内部的$$typeof是REACT_FORWARD_REF_TYPE
    $$typeof: REACT_FORWARD_REF_TYPE,
    //render即包装的FunctionComponent，ClassComponent是不用forwardRef的
    render,
  };
}

