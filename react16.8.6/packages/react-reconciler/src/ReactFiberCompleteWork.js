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
import type {FiberRoot} from './ReactFiberRoot';
import type {
  Instance,
  Type,
  Props,
  Container,
  ChildSet,
} from './ReactFiberHostConfig';
import type {ReactEventComponentInstance} from 'shared/ReactTypes';
import type {
  SuspenseState,
  SuspenseListRenderState,
} from './ReactFiberSuspenseComponent';
import type {SuspenseContext} from './ReactFiberSuspenseContext';

import {now} from './SchedulerWithReactIntegration';

import {
  IndeterminateComponent,
  FunctionComponent,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  ContextProvider,
  ContextConsumer,
  ForwardRef,
  Fragment,
  Mode,
  Profiler,
  SuspenseComponent,
  SuspenseListComponent,
  DehydratedSuspenseComponent,
  MemoComponent,
  SimpleMemoComponent,
  LazyComponent,
  IncompleteClassComponent,
  EventComponent,
} from 'shared/ReactWorkTags';
import {NoMode, BatchedMode} from './ReactTypeOfMode';
import {
  Placement,
  Ref,
  Update,
  NoEffect,
  DidCapture,
  Deletion,
} from 'shared/ReactSideEffectTags';
import invariant from 'shared/invariant';

import {
  createInstance,
  createTextInstance,
  appendInitialChild,
  finalizeInitialChildren,
  prepareUpdate,
  supportsMutation,
  supportsPersistence,
  cloneInstance,
  cloneHiddenInstance,
  cloneHiddenTextInstance,
  createContainerChildSet,
  appendChildToContainerChildSet,
  finalizeContainerChildren,
  updateEventComponent,
} from './ReactFiberHostConfig';
import {
  getRootHostContainer,
  popHostContext,
  getHostContext,
  popHostContainer,
} from './ReactFiberHostContext';
import {
  suspenseStackCursor,
  InvisibleParentSuspenseContext,
  hasSuspenseContext,
  popSuspenseContext,
  pushSuspenseContext,
  setShallowSuspenseContext,
  ForceSuspenseFallback,
  setDefaultShallowSuspenseContext,
} from './ReactFiberSuspenseContext';
import {isShowingAnyFallbacks} from './ReactFiberSuspenseComponent';
import {
  isContextProvider as isLegacyContextProvider,
  popContext as popLegacyContext,
  popTopLevelContextObject as popTopLevelLegacyContextObject,
} from './ReactFiberContext';
import {popProvider} from './ReactFiberNewContext';
import {
  prepareToHydrateHostInstance,
  prepareToHydrateHostTextInstance,
  skipPastDehydratedSuspenseInstance,
  popHydrationState,
} from './ReactFiberHydrationContext';
import {
  enableSchedulerTracing,
  enableSuspenseServerRenderer,
  enableFlareAPI,
} from 'shared/ReactFeatureFlags';
import {
  markSpawnedWork,
  renderDidSuspend,
  renderDidSuspendDelayIfPossible,
  renderHasNotSuspendedYet,
} from './ReactFiberWorkLoop';
import {
  getEventComponentHostChildrenCount,
  createEventComponentInstance,
} from './ReactFiberEvents';
import getComponentName from 'shared/getComponentName';
import warning from 'shared/warning';
import {Never} from './ReactFiberExpirationTime';
import {resetChildFibers} from './ReactChildFiber';
//添加 Update 的 EffectTag
function markUpdate(workInProgress: Fiber) {
  // Tag the fiber with an update effect. This turns a Placement into
  // a PlacementAndUpdate.
  workInProgress.effectTag |= Update;
}
//添加 Ref 的 EffectTag
function markRef(workInProgress: Fiber) {
  workInProgress.effectTag |= Ref;
}

let appendAllChildren;
let updateHostContainer;
let updateHostComponent;
let updateHostText;

//对 DOM 进行操作时为 true
if (supportsMutation) {
  // Mutation mode
  //插入子节点
  appendAllChildren = function(
    parent: Instance,
    workInProgress: Fiber,
    needsVisibilityToggle: boolean,
    isHidden: boolean,
  ) {
    // We only have the top Fiber that was created but we need recurse down its
    // children to find all the terminal nodes.
    //获取该节点的第一个子节点
    let node = workInProgress.child;
    //当该节点有子节点时
    while (node !== null) {
      //如果是原生节点或 text 节点的话
      if (node.tag === HostComponent || node.tag === HostText) {
        //将node.stateNode挂载到 parent 上
        //appendChild API:https://developer.mozilla.org/zh-CN/docs/Web/API/Node/appendChild
        appendInitialChild(parent, node.stateNode);
      } else if (node.tag === HostPortal) {
        // If we have a portal child, then we don't want to traverse
        // down its children. Instead, we'll get insertions from each child in
        // the portal directly.
      }
      //如果子节点还有子子节点的话
      else if (node.child !== null) {
        //return 指向复建点
        node.child.return = node;
        //一直循环，设置return 属性，直到没有子节点
        node = node.child;
        continue;
      }
      if (node === workInProgress) {
        return;
      }
      //如果没有兄弟节点的话，返回至父节点
      while (node.sibling === null) {
        if (node.return === null || node.return === workInProgress) {
          return;
        }
        node = node.return;
      }
      //设置兄弟节点的 return 为父节点
      node.sibling.return = node.return;
      //遍历兄弟节点
      node = node.sibling;
    }
  };

  updateHostContainer = function(workInProgress: Fiber) {
    // Noop
  };
  updateHostComponent = function(
    current: Fiber,
    workInProgress: Fiber,
    type: Type,
    newProps: Props,
    rootContainerInstance: Container,
  ) {
    // If we have an alternate, that means this is an update and we need to
    // schedule a side-effect to do the updates.
    //老 props
    const oldProps = current.memoizedProps;
    //新老 props 对象引用的内存地址没有变过，即没有更新
    if (oldProps === newProps) {
      // In mutation mode, this is sufficient for a bailout because
      // we won't touch this node even if children changed.
      return;
    }

    // If we get updated because one of our children updated, we don't
    // have newProps so we'll have to reuse them.
    // 如果该节点是因为子节点的更新而更新的,那么是没有新 props 需要更新的，但得复用新 props

    // TODO: Split the update API as separate for the props vs. children.
    // Even better would be if children weren't special cased at all tho.
    //todo:用不同的 updateAPI 来区分自身更新和因子节点而更新，是更好的方式

    //获取 DOM 节点实例
    const instance: Instance = workInProgress.stateNode;
    //暂时跳过
    const currentHostContext = getHostContext();
    // TODO: Experiencing an error where oldProps is null. Suggests a host
    // component is hitting the resume path. Figure out why. Possibly
    // related to `hidden`.

    //比较更新得出需要更新的 props 的集合：updatepayload:Array
    const updatePayload = prepareUpdate(
      instance,
      type,
      oldProps,
      newProps,
      rootContainerInstance,
      currentHostContext,
    );
    // TODO: Type this specific to this type of component.
    //将需更新的 props 集合赋值到 更新队列上
    workInProgress.updateQueue = (updatePayload: any);
    // If the update payload indicates that there is a change or if there
    // is a new ref we mark this as an update. All the work is done in commitWork.
    //注意：即使是空数组也会加上 Update 的 EffectTag，如input/option/select/textarea
    if (updatePayload) {
      markUpdate(workInProgress);
    }
  };
  //判断文本节点是否需要更新
  updateHostText = function(
    current: Fiber,
    workInProgress: Fiber,
    oldText: string,
    newText: string,
  ) {
    // If the text differs, mark it as an update. All the work in done in commitWork.
    //由于文本就是 string，可直接通过 === 判断即可
    if (oldText !== newText) {
      //添加 Update 的 EffectTag
      markUpdate(workInProgress);
    }
  };
}
//暂时不用看
// else if (supportsPersistence) {
//   // Persistent host tree mode
//
//   appendAllChildren = function(
//     parent: Instance,
//     workInProgress: Fiber,
//     needsVisibilityToggle: boolean,
//     isHidden: boolean,
//   ) {
//     // We only have the top Fiber that was created but we need recurse down its
//     // children to find all the terminal nodes.
//     let node = workInProgress.child;
//     while (node !== null) {
//       // eslint-disable-next-line no-labels
//       branches: if (node.tag === HostComponent) {
//         let instance = node.stateNode;
//         if (needsVisibilityToggle && isHidden) {
//           // This child is inside a timed out tree. Hide it.
//           const props = node.memoizedProps;
//           const type = node.type;
//           instance = cloneHiddenInstance(instance, type, props, node);
//         }
//         appendInitialChild(parent, instance);
//       } else if (node.tag === HostText) {
//         let instance = node.stateNode;
//         if (needsVisibilityToggle && isHidden) {
//           // This child is inside a timed out tree. Hide it.
//           const text = node.memoizedProps;
//           instance = cloneHiddenTextInstance(instance, text, node);
//         }
//         appendInitialChild(parent, instance);
//       } else if (node.tag === HostPortal) {
//         // If we have a portal child, then we don't want to traverse
//         // down its children. Instead, we'll get insertions from each child in
//         // the portal directly.
//       } else if (node.tag === SuspenseComponent) {
//         if ((node.effectTag & Update) !== NoEffect) {
//           // Need to toggle the visibility of the primary children.
//           const newIsHidden = node.memoizedState !== null;
//           if (newIsHidden) {
//             const primaryChildParent = node.child;
//             if (primaryChildParent !== null) {
//               if (primaryChildParent.child !== null) {
//                 primaryChildParent.child.return = primaryChildParent;
//                 appendAllChildren(
//                   parent,
//                   primaryChildParent,
//                   true,
//                   newIsHidden,
//                 );
//               }
//               const fallbackChildParent = primaryChildParent.sibling;
//               if (fallbackChildParent !== null) {
//                 fallbackChildParent.return = node;
//                 node = fallbackChildParent;
//                 continue;
//               }
//             }
//           }
//         }
//         if (node.child !== null) {
//           // Continue traversing like normal
//           node.child.return = node;
//           node = node.child;
//           continue;
//         }
//       } else if (node.child !== null) {
//         node.child.return = node;
//         node = node.child;
//         continue;
//       }
//       // $FlowFixMe This is correct but Flow is confused by the labeled break.
//       node = (node: Fiber);
//       if (node === workInProgress) {
//         return;
//       }
//       while (node.sibling === null) {
//         if (node.return === null || node.return === workInProgress) {
//           return;
//         }
//         node = node.return;
//       }
//       node.sibling.return = node.return;
//       node = node.sibling;
//     }
//   };
//
//   // An unfortunate fork of appendAllChildren because we have two different parent types.
//   const appendAllChildrenToContainer = function(
//     containerChildSet: ChildSet,
//     workInProgress: Fiber,
//     needsVisibilityToggle: boolean,
//     isHidden: boolean,
//   ) {
//     // We only have the top Fiber that was created but we need recurse down its
//     // children to find all the terminal nodes.
//     let node = workInProgress.child;
//     while (node !== null) {
//       // eslint-disable-next-line no-labels
//       branches: if (node.tag === HostComponent) {
//         let instance = node.stateNode;
//         if (needsVisibilityToggle && isHidden) {
//           // This child is inside a timed out tree. Hide it.
//           const props = node.memoizedProps;
//           const type = node.type;
//           instance = cloneHiddenInstance(instance, type, props, node);
//         }
//         appendChildToContainerChildSet(containerChildSet, instance);
//       } else if (node.tag === HostText) {
//         let instance = node.stateNode;
//         if (needsVisibilityToggle && isHidden) {
//           // This child is inside a timed out tree. Hide it.
//           const text = node.memoizedProps;
//           instance = cloneHiddenTextInstance(instance, text, node);
//         }
//         appendChildToContainerChildSet(containerChildSet, instance);
//       } else if (node.tag === HostPortal) {
//         // If we have a portal child, then we don't want to traverse
//         // down its children. Instead, we'll get insertions from each child in
//         // the portal directly.
//       } else if (node.tag === SuspenseComponent) {
//         if ((node.effectTag & Update) !== NoEffect) {
//           // Need to toggle the visibility of the primary children.
//           const newIsHidden = node.memoizedState !== null;
//           if (newIsHidden) {
//             const primaryChildParent = node.child;
//             if (primaryChildParent !== null) {
//               if (primaryChildParent.child !== null) {
//                 primaryChildParent.child.return = primaryChildParent;
//                 appendAllChildrenToContainer(
//                   containerChildSet,
//                   primaryChildParent,
//                   true,
//                   newIsHidden,
//                 );
//               }
//               const fallbackChildParent = primaryChildParent.sibling;
//               if (fallbackChildParent !== null) {
//                 fallbackChildParent.return = node;
//                 node = fallbackChildParent;
//                 continue;
//               }
//             }
//           }
//         }
//         if (node.child !== null) {
//           // Continue traversing like normal
//           node.child.return = node;
//           node = node.child;
//           continue;
//         }
//       } else if (node.child !== null) {
//         node.child.return = node;
//         node = node.child;
//         continue;
//       }
//       // $FlowFixMe This is correct but Flow is confused by the labeled break.
//       node = (node: Fiber);
//       if (node === workInProgress) {
//         return;
//       }
//       while (node.sibling === null) {
//         if (node.return === null || node.return === workInProgress) {
//           return;
//         }
//         node = node.return;
//       }
//       node.sibling.return = node.return;
//       node = node.sibling;
//     }
//   };
//   updateHostContainer = function(workInProgress: Fiber) {
//     const portalOrRoot: {
//       containerInfo: Container,
//       pendingChildren: ChildSet,
//     } =
//       workInProgress.stateNode;
//     const childrenUnchanged = workInProgress.firstEffect === null;
//     if (childrenUnchanged) {
//       // No changes, just reuse the existing instance.
//     } else {
//       const container = portalOrRoot.containerInfo;
//       let newChildSet = createContainerChildSet(container);
//       // If children might have changed, we have to add them all to the set.
//       appendAllChildrenToContainer(newChildSet, workInProgress, false, false);
//       portalOrRoot.pendingChildren = newChildSet;
//       // Schedule an update on the container to swap out the container.
//       markUpdate(workInProgress);
//       finalizeContainerChildren(container, newChildSet);
//     }
//   };
//   updateHostComponent = function(
//     current: Fiber,
//     workInProgress: Fiber,
//     type: Type,
//     newProps: Props,
//     rootContainerInstance: Container,
//   ) {
//     const currentInstance = current.stateNode;
//     const oldProps = current.memoizedProps;
//     // If there are no effects associated with this node, then none of our children had any updates.
//     // This guarantees that we can reuse all of them.
//     const childrenUnchanged = workInProgress.firstEffect === null;
//     if (childrenUnchanged && oldProps === newProps) {
//       // No changes, just reuse the existing instance.
//       // Note that this might release a previous clone.
//       workInProgress.stateNode = currentInstance;
//       return;
//     }
//     const recyclableInstance: Instance = workInProgress.stateNode;
//     const currentHostContext = getHostContext();
//     let updatePayload = null;
//     if (oldProps !== newProps) {
//       updatePayload = prepareUpdate(
//         recyclableInstance,
//         type,
//         oldProps,
//         newProps,
//         rootContainerInstance,
//         currentHostContext,
//       );
//     }
//     if (childrenUnchanged && updatePayload === null) {
//       // No changes, just reuse the existing instance.
//       // Note that this might release a previous clone.
//       workInProgress.stateNode = currentInstance;
//       return;
//     }
//     let newInstance = cloneInstance(
//       currentInstance,
//       updatePayload,
//       type,
//       oldProps,
//       newProps,
//       workInProgress,
//       childrenUnchanged,
//       recyclableInstance,
//     );
//     if (
//       finalizeInitialChildren(
//         newInstance,
//         type,
//         newProps,
//         rootContainerInstance,
//         currentHostContext,
//       )
//     ) {
//       markUpdate(workInProgress);
//     }
//     workInProgress.stateNode = newInstance;
//     if (childrenUnchanged) {
//       // If there are no other effects in this tree, we need to flag this node as having one.
//       // Even though we're not going to use it for anything.
//       // Otherwise parents won't know that there are new children to propagate upwards.
//       markUpdate(workInProgress);
//     } else {
//       // If children might have changed, we have to add them all to the set.
//       appendAllChildren(newInstance, workInProgress, false, false);
//     }
//   };
//   updateHostText = function(
//     current: Fiber,
//     workInProgress: Fiber,
//     oldText: string,
//     newText: string,
//   ) {
//     if (oldText !== newText) {
//       // If the text content differs, we'll create a new text instance for it.
//       const rootContainerInstance = getRootHostContainer();
//       const currentHostContext = getHostContext();
//       workInProgress.stateNode = createTextInstance(
//         newText,
//         rootContainerInstance,
//         currentHostContext,
//         workInProgress,
//       );
//       // We'll have to mark it as having an effect, even though we won't use the effect for anything.
//       // This lets the parents know that at least one of their children has changed.
//       markUpdate(workInProgress);
//     }
//   };
// } else {
//   // No host operations
//   updateHostContainer = function(workInProgress: Fiber) {
//     // Noop
//   };
//   updateHostComponent = function(
//     current: Fiber,
//     workInProgress: Fiber,
//     type: Type,
//     newProps: Props,
//     rootContainerInstance: Container,
//   ) {
//     // Noop
//   };
//   updateHostText = function(
//     current: Fiber,
//     workInProgress: Fiber,
//     oldText: string,
//     newText: string,
//   ) {
//     // Noop
//   };
// }

function cutOffTailIfNeeded(
  renderState: SuspenseListRenderState,
  hasRenderedATailFallback: boolean,
) {
  switch (renderState.tailMode) {
    case 'collapsed': {
      // Any insertions at the end of the tail list after this point
      // should be invisible. If there are already mounted boundaries
      // anything before them are not considered for collapsing.
      // Therefore we need to go through the whole tail to find if
      // there are any.
      let tailNode = renderState.tail;
      let lastTailNode = null;
      while (tailNode !== null) {
        if (tailNode.alternate !== null) {
          lastTailNode = tailNode;
        }
        tailNode = tailNode.sibling;
      }
      // Next we're simply going to delete all insertions after the
      // last rendered item.
      if (lastTailNode === null) {
        // All remaining items in the tail are insertions.
        if (!hasRenderedATailFallback && renderState.tail !== null) {
          // We suspended during the head. We want to show at least one
          // row at the tail. So we'll keep on and cut off the rest.
          renderState.tail.sibling = null;
        } else {
          renderState.tail = null;
        }
      } else {
        // Detach the insertion after the last node that was already
        // inserted.
        lastTailNode.sibling = null;
      }
      break;
    }
  }
}

// Note this, might mutate the workInProgress passed in.
function hasSuspendedChildrenAndNewContent(
  workInProgress: Fiber,
  firstChild: null | Fiber,
): boolean {
  // Traversal to see if any of the immediately nested Suspense boundaries
  // are in their fallback states. I.e. something suspended in them.
  // And if some of them have new content that wasn't already visible.
  let hasSuspendedBoundaries = false;
  let hasNewContent = false;

  let node = firstChild;
  while (node !== null) {
    // TODO: Hidden subtrees should not be considered.
    if (node.tag === SuspenseComponent) {
      const state: SuspenseState | null = node.memoizedState;
      const isShowingFallback = state !== null;
      if (isShowingFallback) {
        // Tag the parent fiber as having suspended boundaries.
        if (!hasSuspendedBoundaries) {
          workInProgress.effectTag |= DidCapture;
        }

        hasSuspendedBoundaries = true;

        if (node.updateQueue !== null) {
          // If this is a newly suspended tree, it might not get committed as
          // part of the second pass. In that case nothing will subscribe to
          // its thennables. Instead, we'll transfer its thennables to the
          // SuspenseList so that it can retry if they resolve.
          // There might be multiple of these in the list but since we're
          // going to wait for all of them anyway, it doesn't really matter
          // which ones gets to ping. In theory we could get clever and keep
          // track of how many dependencies remain but it gets tricky because
          // in the meantime, we can add/remove/change items and dependencies.
          // We might bail out of the loop before finding any but that
          // doesn't matter since that means that the other boundaries that
          // we did find already has their listeners attached.
          workInProgress.updateQueue = node.updateQueue;
          workInProgress.effectTag |= Update;
        }
      } else {
        const current = node.alternate;
        const wasNotShowingContent =
          current === null || current.memoizedState !== null;
        if (wasNotShowingContent) {
          hasNewContent = true;
        }
      }
      if (hasSuspendedBoundaries && hasNewContent) {
        return true;
      }
    } else {
      // TODO: We can probably just use the information from the list and not
      // drill into its children just like if it was a Suspense boundary.
      if (node.tag === SuspenseListComponent && node.updateQueue !== null) {
        // If there's a nested SuspenseList, we might have transferred
        // the thennables set to it already so we must get it from there.
        workInProgress.updateQueue = node.updateQueue;
        workInProgress.effectTag |= Update;
      }

      if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
    }
    if (node === workInProgress) {
      return false;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === workInProgress) {
        return false;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
  return false;
}

//更新不同的组件/节点
function completeWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
): Fiber | null {
  const newProps = workInProgress.pendingProps;

  switch (workInProgress.tag) {
    //组件的初始状态
    case IndeterminateComponent:
      break;
    //懒（动态）加载组件
    //https://zh-hans.reactjs.org/docs/react-api.html#reactlazy

    //也可以看下这篇文章：React的动态加载（lazy import）https://www.jianshu.com/p/27cc69eb4556
    case LazyComponent:
      break;
    //和 React.memo 类似
    //https://zh-hans.reactjs.org/docs/react-api.html#reactmemo
    case SimpleMemoComponent:
    //函数组件
    //https://zh-hans.reactjs.org/docs/components-and-props.html#function-and-class-components
    case FunctionComponent:
      break;
    //类/class 组件
    //https://zh-hans.reactjs.org/docs/components-and-props.html#function-and-class-components
    case ClassComponent: {
      const Component = workInProgress.type;
      //======context 相关，暂时跳过==========================
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      break;
    }
    //fiberRoot 节点的更新
    case HostRoot: {
      //出栈操作
      //将 valueStack 栈中指定位置的 value 赋值给不同 StackCursor.current
      popHostContainer(workInProgress);
      //同上
      popTopLevelLegacyContextObject(workInProgress);
      // context 相关，可跳过
      const fiberRoot = (workInProgress.stateNode: FiberRoot);
      if (fiberRoot.pendingContext) {
        fiberRoot.context = fiberRoot.pendingContext;
        fiberRoot.pendingContext = null;
      }
      if (current === null || current.child === null) {
        // If we hydrated, pop so that we can delete any remaining children
        // that weren't hydrated.
        popHydrationState(workInProgress);
        // This resets the hacky state to fix isMounted before committing.
        // TODO: Delete this when we delete isMounted and findDOMNode.
        workInProgress.effectTag &= ~Placement;
      }
      updateHostContainer(workInProgress);
      break;
    }
    //DOM 节点的更新，涉及到 virtual dom
    //https://zh-hans.reactjs.org/docs/faq-internals.html#___gatsby
    case HostComponent: {
      //context 相关，暂时跳过
      //只有当contextFiber的 current 是当前 fiber 时，才会出栈
      popHostContext(workInProgress);
      const rootContainerInstance = getRootHostContainer();
      //==================
      //节点类型，比如<div>标签对应的 fiber 对象的 type 为 "div"
      const type = workInProgress.type;
      //如果不是第一次渲染的话
      if (current !== null && workInProgress.stateNode != null) {
        //更新 DOM 时进行 diff 判断
        //获取更新队列 workInProgress.updateQueue
        updateHostComponent(
          current,
          workInProgress,
          type,
          newProps,
          rootContainerInstance,
        );
        //ref指向有变动的话，更新 ref
        if (current.ref !== workInProgress.ref) {
          ////添加 Ref 的 EffectTag
          markRef(workInProgress);
        }
      }

      else {
        //如果是第一次渲染的话

        //如果没有新 props 更新，但是执行到这里的话，可能是 React 内部出现了问题
        if (!newProps) {
          invariant(
            workInProgress.stateNode !== null,
            'We must have new props for new mounts. This error is likely ' +
              'caused by a bug in React. Please file an issue.',
          );
          // This can happen when we abort work.
          break;
        }
        //context 相关，暂时跳过
        const currentHostContext = getHostContext();
        // TODO: Move createInstance to beginWork and keep it on a context
        // "stack" as the parent. Then append children as we go in beginWork
        // or completeWork depending on we want to add then top->down or
        // bottom->up. Top->down is faster in IE11.
        //是否曾是服务端渲染
        let wasHydrated = popHydrationState(workInProgress);
        //如果是服务端渲染的话，暂时跳过
        if (wasHydrated) {
          // TODO: Move this and createInstance step into the beginPhase
          // to consolidate.
          if (
            prepareToHydrateHostInstance(
              workInProgress,
              rootContainerInstance,
              currentHostContext,
            )
          ) {
            // If changes to the hydrated node needs to be applied at the
            // commit-phase we mark this as such.
            markUpdate(workInProgress);
          }
        }
        //不是服务端渲染
        else {
           //创建 DOM 实例
           //1、创建 DOM 元素
           //2、创建指向 fiber 对象的属性，方便从DOM 实例上获取 fiber 对象
           //3、创建指向 props 的属性，方便从 DOM 实例上获取 props
          let instance = createInstance(
            type,
            newProps,
            rootContainerInstance,
            currentHostContext,
            workInProgress,
          );
          //插入子节点
          appendAllChildren(instance, workInProgress, false, false);

          // Certain renderers require commit-time effects for initial mount.
          // (eg DOM renderer supports auto-focus for certain elements).
          // Make sure such renderers get scheduled for later work.
          if (
            //初始化事件监听
            //如果该节点能够自动聚焦的话
            finalizeInitialChildren(
              instance,
              type,
              newProps,
              rootContainerInstance,
              currentHostContext,
            )
          ) {
            //添加 EffectTag，方便在 commit 阶段 update
            markUpdate(workInProgress);
          }
          //将处理好的节点实例绑定到 stateNode 上
          workInProgress.stateNode = instance;
        }
        //如果 ref 引用不为空的话
        if (workInProgress.ref !== null) {
          // If there is a ref on a host node we need to schedule a callback
          //添加 Ref 的 EffectTag
          markRef(workInProgress);
        }
      }
      break;
    }
    //文本节点的更新
    case HostText: {
      //由于是文本节点，所以 newProps 是 string 字符串
      let newText = newProps;
      //如果不是第一次渲染的话
      if (current && workInProgress.stateNode != null) {
        const oldText = current.memoizedProps;
        // If we have an alternate, that means this is an update and we need
        // to schedule a side-effect to do the updates.
        //如果与workInProgress相对于的alternate存在的话，说明有更新
        //那么就添加 Update 的 effectTag
        //判断更新文本节点
        updateHostText(current, workInProgress, oldText, newText);
      }
      //如果是第一次渲染的话
      else {
        //当文本节点更新的内容不是 string 类型的话，说明 React 内部出现了 error
        if (typeof newText !== 'string') {
          invariant(
            workInProgress.stateNode !== null,
            'We must have new props for new mounts. This error is likely ' +
              'caused by a bug in React. Please file an issue.',
          );
          // This can happen when we abort work.
        }
        // context 相关，暂时跳过
        const rootContainerInstance = getRootHostContainer();
        const currentHostContext = getHostContext();
        //曾是服务端渲染
        let wasHydrated = popHydrationState(workInProgress);
        //如果是服务端渲染的话，暂时跳过
        if (wasHydrated) {
          if (prepareToHydrateHostTextInstance(workInProgress)) {
            markUpdate(workInProgress);
          }
        }
        //不是服务端渲染
        else {
          //第一次渲染的话，创建文本节点的实例并赋值给 stateNode
          workInProgress.stateNode = createTextInstance(
            newText,
            rootContainerInstance,
            currentHostContext,
            workInProgress,
          );
        }
      }
      break;
    }
    //React.forwardRef 组件的更新
    //https://zh-hans.reactjs.org/docs/react-api.html#reactforwardref
    case ForwardRef:
      break;
    //suspense 组件的更新
    //https://zh-hans.reactjs.org/docs/concurrent-mode-reference.html#suspense
    case SuspenseComponent: {
      popSuspenseContext(workInProgress);
      const nextState: null | SuspenseState = workInProgress.memoizedState;
      if ((workInProgress.effectTag & DidCapture) !== NoEffect) {
        // Something suspended. Re-render with the fallback children.
        workInProgress.expirationTime = renderExpirationTime;
        // Do not reset the effect list.
        return workInProgress;
      }

      const nextDidTimeout = nextState !== null;
      let prevDidTimeout = false;
      if (current === null) {
        // In cases where we didn't find a suitable hydration boundary we never
        // downgraded this to a DehydratedSuspenseComponent, but we still need to
        // pop the hydration state since we might be inside the insertion tree.
        popHydrationState(workInProgress);
      } else {
        const prevState: null | SuspenseState = current.memoizedState;
        prevDidTimeout = prevState !== null;
        if (!nextDidTimeout && prevState !== null) {
          // We just switched from the fallback to the normal children.
          // Delete the fallback.
          // TODO: Would it be better to store the fallback fragment on
          // the stateNode during the begin phase?
          const currentFallbackChild: Fiber | null = (current.child: any)
            .sibling;
          if (currentFallbackChild !== null) {
            // Deletions go at the beginning of the return fiber's effect list
            const first = workInProgress.firstEffect;
            if (first !== null) {
              workInProgress.firstEffect = currentFallbackChild;
              currentFallbackChild.nextEffect = first;
            } else {
              workInProgress.firstEffect = workInProgress.lastEffect = currentFallbackChild;
              currentFallbackChild.nextEffect = null;
            }
            currentFallbackChild.effectTag = Deletion;
          }
        }
      }

      if (nextDidTimeout && !prevDidTimeout) {
        // If this subtreee is running in batched mode we can suspend,
        // otherwise we won't suspend.
        // TODO: This will still suspend a synchronous tree if anything
        // in the concurrent tree already suspended during this render.
        // This is a known bug.
        if ((workInProgress.mode & BatchedMode) !== NoMode) {
          // TODO: Move this back to throwException because this is too late
          // if this is a large tree which is common for initial loads. We
          // don't know if we should restart a render or not until we get
          // this marker, and this is too late.
          // If this render already had a ping or lower pri updates,
          // and this is the first time we know we're going to suspend we
          // should be able to immediately restart from within throwException.
          const hasInvisibleChildContext =
            current === null &&
            workInProgress.memoizedProps.unstable_avoidThisFallback !== true;
          if (
            hasInvisibleChildContext ||
            hasSuspenseContext(
              suspenseStackCursor.current,
              (InvisibleParentSuspenseContext: SuspenseContext),
            )
          ) {
            // If this was in an invisible tree or a new render, then showing
            // this boundary is ok.
            renderDidSuspend();
          } else {
            // Otherwise, we're going to have to hide content so we should
            // suspend for longer if possible.
            renderDidSuspendDelayIfPossible();
          }
        }
      }

      if (supportsPersistence) {
        // TODO: Only schedule updates if not prevDidTimeout.
        if (nextDidTimeout) {
          // If this boundary just timed out, schedule an effect to attach a
          // retry listener to the proimse. This flag is also used to hide the
          // primary children.
          workInProgress.effectTag |= Update;
        }
      }
      if (supportsMutation) {
        // TODO: Only schedule updates if these values are non equal, i.e. it changed.
        if (nextDidTimeout || prevDidTimeout) {
          // If this boundary just timed out, schedule an effect to attach a
          // retry listener to the proimse. This flag is also used to hide the
          // primary children. In mutation mode, we also need the flag to
          // *unhide* children that were previously hidden, so check if the
          // is currently timed out, too.
          workInProgress.effectTag |= Update;
        }
      }
      break;
    }
    //React.Fragment 的更新
    //https://zh-hans.reactjs.org/docs/react-api.html#reactfragment
    case Fragment:
      break;
    //暂时不知道是什么组件/节点
    case Mode:
      break;
    //Profiler 组件的更新
    //https://zh-hans.reactjs.org/docs/profiler.html#___gatsby
    case Profiler:
      break;
    //React.createportal 节点的更新
    //https://zh-hans.reactjs.org/docs/react-dom.html#createportal
    case HostPortal:
      popHostContainer(workInProgress);
      updateHostContainer(workInProgress);
      break;
    //Context.Provider 组件的更新
    //https://zh-hans.reactjs.org/docs/context.html#contextprovider
    case ContextProvider:
      // Pop provider fiber
      popProvider(workInProgress);
      break;
    //Context.Consumer 组件的更新
    //https://zh-hans.reactjs.org/docs/context.html#contextconsumer
    case ContextConsumer:
      break;
    //React.Memo 组件的更新
    //https://zh-hans.reactjs.org/docs/react-api.html#reactmemo
    case MemoComponent:
      break;
    //未完成/被中断的 class 组件的更新
    case IncompleteClassComponent: {
      // Same as class component case. I put it down here so that the tags are
      // sequential to ensure this switch is compiled to a jump table.
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      break;
    }
    //不是 server 端渲染的 suspense 组件的更新
    case DehydratedSuspenseComponent: {
      if (enableSuspenseServerRenderer) {
        popSuspenseContext(workInProgress);
        if (current === null) {
          let wasHydrated = popHydrationState(workInProgress);
          invariant(
            wasHydrated,
            'A dehydrated suspense component was completed without a hydrated node. ' +
              'This is probably a bug in React.',
          );
          if (enableSchedulerTracing) {
            markSpawnedWork(Never);
          }
          skipPastDehydratedSuspenseInstance(workInProgress);
        } else if ((workInProgress.effectTag & DidCapture) === NoEffect) {
          // This boundary did not suspend so it's now hydrated.
          // To handle any future suspense cases, we're going to now upgrade it
          // to a Suspense component. We detach it from the existing current fiber.
          current.alternate = null;
          workInProgress.alternate = null;
          workInProgress.tag = SuspenseComponent;
          workInProgress.memoizedState = null;
          workInProgress.stateNode = null;
        }
      }
      break;
    }
    //SuspenseList 组件的更新
    //https://zh-hans.reactjs.org/docs/concurrent-mode-reference.html#suspenselist
    case SuspenseListComponent: {
      popSuspenseContext(workInProgress);

      const renderState: null | SuspenseListRenderState =
        workInProgress.memoizedState;

      if (renderState === null) {
        // We're running in the default, "independent" mode. We don't do anything
        // in this mode.
        break;
      }

      let didSuspendAlready =
        (workInProgress.effectTag & DidCapture) !== NoEffect;

      let renderedTail = renderState.rendering;
      if (renderedTail === null) {
        // We just rendered the head.
        if (!didSuspendAlready) {
          // This is the first pass. We need to figure out if anything is still
          // suspended in the rendered set.
          const renderedChildren = workInProgress.child;
          // If new content unsuspended, but there's still some content that
          // didn't. Then we need to do a second pass that forces everything
          // to keep showing their fallbacks.

          // We might be suspended if something in this render pass suspended, or
          // something in the previous committed pass suspended. Otherwise,
          // there's no chance so we can skip the expensive call to
          // hasSuspendedChildrenAndNewContent.
          let cannotBeSuspended =
            renderHasNotSuspendedYet() &&
            (current === null || (current.effectTag & DidCapture) === NoEffect);
          let needsRerender =
            !cannotBeSuspended &&
            hasSuspendedChildrenAndNewContent(workInProgress, renderedChildren);
          if (needsRerender) {
            // Rerender the whole list, but this time, we'll force fallbacks
            // to stay in place.
            // Reset the effect list before doing the second pass since that's now invalid.
            workInProgress.firstEffect = workInProgress.lastEffect = null;
            // Reset the child fibers to their original state.
            resetChildFibers(workInProgress, renderExpirationTime);

            // Set up the Suspense Context to force suspense and immediately
            // rerender the children.
            pushSuspenseContext(
              workInProgress,
              setShallowSuspenseContext(
                suspenseStackCursor.current,
                ForceSuspenseFallback,
              ),
            );
            return workInProgress.child;
          }
          // hasSuspendedChildrenAndNewContent could've set didSuspendAlready
          didSuspendAlready =
            (workInProgress.effectTag & DidCapture) !== NoEffect;
        }
        if (didSuspendAlready) {
          cutOffTailIfNeeded(renderState, false);
        }
        // Next we're going to render the tail.
      } else {
        // Append the rendered row to the child list.
        if (!didSuspendAlready) {
          if (isShowingAnyFallbacks(renderedTail)) {
            workInProgress.effectTag |= DidCapture;
            didSuspendAlready = true;
            cutOffTailIfNeeded(renderState, true);
          } else if (
            now() > renderState.tailExpiration &&
            renderExpirationTime > Never
          ) {
            // We have now passed our CPU deadline and we'll just give up further
            // attempts to render the main content and only render fallbacks.
            // The assumption is that this is usually faster.
            workInProgress.effectTag |= DidCapture;
            didSuspendAlready = true;

            cutOffTailIfNeeded(renderState, false);

            // Since nothing actually suspended, there will nothing to ping this
            // to get it started back up to attempt the next item. If we can show
            // them, then they really have the same priority as this render.
            // So we'll pick it back up the very next render pass once we've had
            // an opportunity to yield for paint.

            const nextPriority = renderExpirationTime - 1;
            workInProgress.expirationTime = workInProgress.childExpirationTime = nextPriority;
            if (enableSchedulerTracing) {
              markSpawnedWork(nextPriority);
            }
          }
        }
        if (renderState.isBackwards) {
          // The effect list of the backwards tail will have been added
          // to the end. This breaks the guarantee that life-cycles fire in
          // sibling order but that isn't a strong guarantee promised by React.
          // Especially since these might also just pop in during future commits.
          // Append to the beginning of the list.
          renderedTail.sibling = workInProgress.child;
          workInProgress.child = renderedTail;
        } else {
          let previousSibling = renderState.last;
          if (previousSibling !== null) {
            previousSibling.sibling = renderedTail;
          } else {
            workInProgress.child = renderedTail;
          }
          renderState.last = renderedTail;
        }
      }

      if (renderState.tail !== null) {
        // We still have tail rows to render.
        if (renderState.tailExpiration === 0) {
          // Heuristic for how long we're willing to spend rendering rows
          // until we just give up and show what we have so far.
          const TAIL_EXPIRATION_TIMEOUT_MS = 500;
          renderState.tailExpiration = now() + TAIL_EXPIRATION_TIMEOUT_MS;
        }
        // Pop a row.
        let next = renderState.tail;
        renderState.rendering = next;
        renderState.tail = next.sibling;
        next.sibling = null;

        // Restore the context.
        // TODO: We can probably just avoid popping it instead and only
        // setting it the first time we go from not suspended to suspended.
        let suspenseContext = suspenseStackCursor.current;
        if (didSuspendAlready) {
          suspenseContext = setShallowSuspenseContext(
            suspenseContext,
            ForceSuspenseFallback,
          );
        } else {
          suspenseContext = setDefaultShallowSuspenseContext(suspenseContext);
        }
        pushSuspenseContext(workInProgress, suspenseContext);
        // Do a pass over the next row.
        return next;
      }
      break;
    }
    //事件组件 的更新，暂未找到相关资料
    case EventComponent: {
      if (enableFlareAPI) {
        popHostContext(workInProgress);
        const rootContainerInstance = getRootHostContainer();
        const responder = workInProgress.type.responder;
        let eventComponentInstance: ReactEventComponentInstance<
          any,
          any,
          any,
        > | null =
          workInProgress.stateNode;

        if (eventComponentInstance === null) {
          let responderState = null;
          if (__DEV__ && !responder.allowMultipleHostChildren) {
            const hostChildrenCount = getEventComponentHostChildrenCount(
              workInProgress,
            );
            warning(
              (hostChildrenCount || 0) < 2,
              'A "<%s>" event component cannot contain multiple host children.',
              getComponentName(workInProgress.type),
            );
          }
          const getInitialState = responder.getInitialState;
          if (getInitialState !== undefined) {
            responderState = getInitialState(newProps);
          }
          eventComponentInstance = workInProgress.stateNode = createEventComponentInstance(
            workInProgress,
            newProps,
            responder,
            rootContainerInstance,
            responderState || {},
            false,
          );
          markUpdate(workInProgress);
        } else {
          // Update the props on the event component state node
          eventComponentInstance.props = newProps;
          // Update the current fiber
          eventComponentInstance.currentFiber = workInProgress;
          updateEventComponent(eventComponentInstance);
        }
      }
      break;
    }
    default:
      invariant(
        false,
        'Unknown unit of work tag. This error is likely caused by a bug in ' +
          'React. Please file an issue.',
      );
  }

  return null;
}

export {completeWork};
