/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';
import type {ExpirationTime} from './ReactFiberExpirationTime';

import {
  ClassComponent,
  HostRoot,
  HostComponent,
  HostPortal,
  ContextProvider,
  SuspenseComponent,
  SuspenseListComponent,
  DehydratedSuspenseComponent,
  EventComponent,
} from 'shared/ReactWorkTags';
import {DidCapture, NoEffect, ShouldCapture} from 'shared/ReactSideEffectTags';
import {
  enableSuspenseServerRenderer,
  enableFlareAPI,
} from 'shared/ReactFeatureFlags';

import {popHostContainer, popHostContext} from './ReactFiberHostContext';
import {popSuspenseContext} from './ReactFiberSuspenseContext';
import {
  isContextProvider as isLegacyContextProvider,
  popContext as popLegacyContext,
  popTopLevelContextObject as popTopLevelLegacyContextObject,
} from './ReactFiberContext';
import {popProvider} from './ReactFiberNewContext';

import invariant from 'shared/invariant';

//根据不同组件的类型和目标节点的effectTag，判断返回该节点还是 null
function unwindWork(
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
) {
  switch (workInProgress.tag) {
    //注意：只有ClassComponent和SuspenseComponent有ShouldCaptutre 的 sideEffect
    //也就是说，只有 ClassComponent和SuspenseComponent能捕获到错误
    case ClassComponent: {
      //===暂时跳过===
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      //获取effectTag
      const effectTag = workInProgress.effectTag;
      //如果 effectTag 上有 ShouldCapture 的副作用（side-effect）的话，
      //就将 ShouldCapture 去掉，加上 DidCapture 的副作用
      if (effectTag & ShouldCapture) {
        workInProgress.effectTag = (effectTag & ~ShouldCapture) | DidCapture;
        return workInProgress;
      }
      return null;
    }
    //如果fiberRoot 节点捕获到错误的话，则说明能处理错误的子节点没有去处理
    //可能是 React 内部的 bug
    case HostRoot: {
      popHostContainer(workInProgress);
      popTopLevelLegacyContextObject(workInProgress);
      const effectTag = workInProgress.effectTag;
      invariant(
        (effectTag & DidCapture) === NoEffect,
        'The root failed to unmount after an error. This is likely a bug in ' +
        'React. Please file an issue.',
      );
      workInProgress.effectTag = (effectTag & ~ShouldCapture) | DidCapture;
      return workInProgress;
    }
    //即 DOM 元素，会直接返回 null
    //也就是说，会交给父节点去处理
    //如果父节点仍是 HostComponent 的话，会向上递归，直到到达ClassComponent
    //然后让ClassComponent捕获 error
    case HostComponent: {
      // TODO: popHydrationState
      popHostContext(workInProgress);
      return null;
    }
    case SuspenseComponent: {
      popSuspenseContext(workInProgress);
      const effectTag = workInProgress.effectTag;
      if (effectTag & ShouldCapture) {
        workInProgress.effectTag = (effectTag & ~ShouldCapture) | DidCapture;
        // Captured a suspense effect. Re-render the boundary.
        return workInProgress;
      }
      return null;
    }
    case DehydratedSuspenseComponent: {
      if (enableSuspenseServerRenderer) {
        // TODO: popHydrationState
        popSuspenseContext(workInProgress);
        const effectTag = workInProgress.effectTag;
        if (effectTag & ShouldCapture) {
          workInProgress.effectTag = (effectTag & ~ShouldCapture) | DidCapture;
          // Captured a suspense effect. Re-render the boundary.
          return workInProgress;
        }
      }
      return null;
    }
    case SuspenseListComponent: {
      popSuspenseContext(workInProgress);
      // SuspenseList doesn't actually catch anything. It should've been
      // caught by a nested boundary. If not, it should bubble through.
      return null;
    }
    case HostPortal:
      popHostContainer(workInProgress);
      return null;
    case ContextProvider:
      popProvider(workInProgress);
      return null;
    case EventComponent:
      if (enableFlareAPI) {
        popHostContext(workInProgress);
      }
      return null;
    default:
      return null;
  }
}

function unwindInterruptedWork(interruptedWork: Fiber) {
  // react16.8.6/packages/shared/ReactWorkTags.js
  switch (interruptedWork.tag) {
    case ClassComponent: {
      const childContextTypes = interruptedWork.type.childContextTypes;
      if (childContextTypes !== null && childContextTypes !== undefined) {
        popLegacyContext(interruptedWork);
      }
      break;
    }
    case HostRoot: {
      popHostContainer(interruptedWork);
      popTopLevelLegacyContextObject(interruptedWork);
      break;
    }
    case HostComponent: {
      popHostContext(interruptedWork);
      break;
    }
    case HostPortal:
      popHostContainer(interruptedWork);
      break;
    case SuspenseComponent:
      popSuspenseContext(interruptedWork);
      break;
    case DehydratedSuspenseComponent:
      if (enableSuspenseServerRenderer) {
        // TODO: popHydrationState
        popSuspenseContext(interruptedWork);
      }
      break;
    case SuspenseListComponent:
      popSuspenseContext(interruptedWork);
      break;
    case ContextProvider:
      popProvider(interruptedWork);
      break;
    case EventComponent:
      if (enableFlareAPI) {
        popHostContext(interruptedWork);
      }
      break;
    default:
      break;
  }
}

export {unwindWork, unwindInterruptedWork};
