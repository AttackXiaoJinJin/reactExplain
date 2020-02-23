/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export type SideEffectTag = number;

// Don't change these two values. They're used by React Dev Tools.
// 初始值
export const NoEffect = /*              */ 0b000000000000; //0
// 开始处理后置为 PerformedWork
export const PerformedWork = /*         */ 0b000000000001; //1

// You can change the rest (and add more).
// 插入、移动 dom 节点
export const Placement = /*             */ 0b000000000010; //2
// 更新 dom 节点的类型或内容
export const Update = /*                */ 0b000000000100; //4
// 移动并更新 dom 节点
export const PlacementAndUpdate = /*    */ 0b000000000110; //6
// 删除 dom 节点
export const Deletion = /*              */ 0b000000001000; //8
// 将只包含字符串的 dom 节点替换成其他节点
export const ContentReset = /*          */ 0b000000010000; //16
// setState 的回调类型
export const Callback = /*              */ 0b000000100000; //32
// 渲染出错，捕获到错误信息
export const DidCapture = /*            */ 0b000001000000; //64
// ref 的回调类型
export const Ref = /*                   */ 0b000010000000; //128
// 执行 getSnapshotBeforeUpdate 后赋值
export const Snapshot = /*              */ 0b000100000000; //256
export const Passive = /*               */ 0b001000000000; //512

// Passive & Update & Callback & Ref & Snapshot
export const LifecycleEffectMask = /*   */ 0b001110100100; //932

// Union of all host effects
export const HostEffectMask = /*        */ 0b001111111111; //1023
// 任何造成 fiber 的 work 无法完成的情况
export const Incomplete = /*            */ 0b010000000000; //1024
// 需要处理错误
export const ShouldCapture = /*         */ 0b100000000000; //2048
