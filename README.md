<h1>React源码解析</h1>
<h3>说明</h3>

* 本源码可从[https://github.com/AttackXiaoJinJin/reactExplain/blob/master/react16.8.6/CHANGELOG.md](https://github.com/AttackXiaoJinJin/reactExplain/blob/master/react16.8.6/CHANGELOG.md)
查看版本号，建议直接 fork，若从官网下载源码，考虑到 [文件名称被rename](https://github.com/AttackXiaoJinJin/reactExplain/issues/147) 的问题，建议版本号从16.9.0开始
官网 release 地址：
[https://github.com/facebook/react/releases?after=v16.10.2](https://github.com/facebook/react/releases?after=v16.10.2)

* 如果找不到对应的`函数名`/`文件名`，建议全局搜索里面的代码块进行查找

<h3>API</h3>

[React源码解析之React.createElement()和ReactElement()](https://juejin.im/post/5d2b0763f265da1bd14686c5)
<br/><br/>
[React源码解析之React.Component()/PureComponent()](https://juejin.im/post/5d2e754f6fb9a07f070e600e)
<br/><br/>
[React源码解析之React.createRef()/forwardRef()](https://juejin.im/post/5d39afe65188257dc103e9f5)
<br/><br/>
[React源码解析之React.createContext()](https://juejin.im/post/5d3efff3e51d4561a34618c0)
<br/><br/>
[React源码解析之React.children.map()](https://juejin.im/post/5d46b71a6fb9a06b0c084acd)
<br/><br/>
[React.forwardRef的应用场景及源码解析](https://juejin.im/post/5e52263de51d4526dd1ea1fe)

***
<h3>FiberScheduler</h3>

[React源码解析之ReactDOM.render()](https://juejin.im/post/5d535e7be51d45620771f0b2)
<br/><br/>
[React源码解析之RootFiber](https://juejin.im/post/5d5aa4695188257573635a0d)
<br/><br/>
[React源码解析之Update和UpdateQueue](https://juejin.im/post/5d62645bf265da03ec2e6f33)
<br/><br/>
[React源码解析之ExpirationTime](https://juejin.im/post/5d6a572ce51d4561fa2ec0bc)
<br/><br/>
[React源码解析之setState和forceUpdate](https://juejin.im/post/5d705e555188255457502380)
<br/><br/>
[React源码解析之FiberRoot](https://juejin.im/post/5d75a66ce51d4561e84fcc9b)
<br/><br/>
[React源码解析之scheduleWork（上）](https://juejin.im/post/5d7fa983f265da03cf7ac048)
<br/><br/>
[React源码解析之scheduleWork（下）](https://juejin.im/post/5d885b75f265da03e83baaa7)
<br/><br/>
[React源码解析之requestHostCallback](https://juejin.im/post/5da2d5725188252a923a8ec5)
<br/><br/>
[React源码解析之flushWork](https://juejin.im/post/5dad45575188256ad9347402)
<br/><br/>
[React源码解析之renderRoot概览](https://juejin.im/post/5db7f39f6fb9a0207f102ee7)
<br/><br/>
[React源码解析之workLoop](https://juejin.im/post/5dcc17b26fb9a02b6a6ff999)

***
<h3>ComponentUpdate</h3>

[React之childExpirationTime](https://juejin.im/post/5dcdfee86fb9a01ff600fe1d)
<br/><br/>
[React源码解析之FunctionComponent（上）](https://juejin.im/post/5ddbe114e51d45231e010c75)
<br/><br/>
[React源码解析之FunctionComponent（中）](https://juejin.im/post/5de8cf74f265da33ac2ce132)
<br/><br/>
[React源码解析之FunctionComponent（下）](https://juejin.im/post/5deb93976fb9a016464340b0)
<br/><br/>
[React源码解析之updateClassComponent（上）](https://juejin.im/post/5e1bc74ee51d45020837e8f4)
<br/><br/>
[React源码解析之updateClassComponent（下）](https://juejin.im/post/5e1d17e75188254dc022bbee)
<br/><br/>
[React源码解析之PureComponet的浅比较](https://juejin.im/post/5e2150535188254dbc25e6cf)
<br/><br/>
[React源码解析之IndeterminateComponent](https://juejin.im/post/5e26a131e51d453cf54449b5)
<br/><br/>
[React源码解析之updateHostComponent和updateHostText](https://juejin.im/post/5e398018f265da5765439b57)

***
<h3>NodeUpdate</h3>

[React源码解析之completeUnitOfWork](https://juejin.im/post/5e4a02bd51882549122aa50c)
<br/><br/>
[React源码解析之completeWork和HostText的更新](https://juejin.im/post/5e535d7e6fb9a07cbf46b282)
<br/><br/>
[React源码解析之HostComponent的更新(上)](https://juejin.im/post/5e5c5e1051882549003d1fc7)
<br/><br/>
[React源码解析之HostComponent的更新(下)](https://juejin.im/post/5e65f86f6fb9a07cdc600e09)
***
<h3>错误处理</h3>

[React源码解析之「错误处理」流程](https://juejin.im/post/5e7963956fb9a07cdc60253f)
***
<h3>Commit阶段</h3>

[React源码解析之commitRoot整体流程概览](https://juejin.im/post/5e829d1e6fb9a03c621666b5)
<br/><br/>
[React源码解析之Commit第一子阶段「before mutation」](https://juejin.im/post/5e883ff76fb9a03c860b6ab0)
<br/><br/>
[React源码解析之Commit第二子阶段「mutation」(上)](https://juejin.im/post/5e8ad1436fb9a03c3c351447)
<br/><br/>
[React源码解析之Commit第二子阶段「mutation」(中)](https://juejin.im/post/5e92b851f265da47bf17bdc6)
<br/><br/>
[React源码解析之Commit第二子阶段「mutation」(下)](https://juejin.im/post/5e9ae787e51d454701257e45)
<br/><br/>
[React源码解析之Commit最后子阶段「layout」(附Commit阶段流程图)](https://juejin.im/post/5ea6f1746fb9a0437c3929c5)
<br/><br/>
***
<h3>React-Hooks</h3>

[ReactHooks源码解析之useState及为什么useState要按顺序执行](https://juejin.im/post/5eb7c96ff265da7b90055137)
<br/><br/>
[ReactHooks源码解析之useEffect](https://juejin.im/post/5ed3356bf265da76cf6e4f75)
<br/><br/>
***
<h2>微信公众号</h2>

每周分享前端干货和生活感悟！

![](https://upload-images.jianshu.io/upload_images/5518628-d990fd52db10fd66.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/1240)

