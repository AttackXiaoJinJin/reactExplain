import React from 'react'
//funciton component是没有dom实例的，因为它是PureComponent，所以没有this，
// 所以不能通过createRef()来拿到实例

//将Father的father传给子组件，并绑定子组件的DOM实例，从而能在父组件拿到子组件的DOM实例
const Child=React.forwardRef((props,ref)=>{
  return <div ref={ref}>child div</div>
})

export default class Father extends  React.Completed{
  constructor(props){
    super(props)
    this.father=React.createRef()
  }

  componentDidMount(){
    this.father.current.value='hahhaha'
  }

  render(){
    return <Child ref={this.father} />
  }

}
