import React from 'react'

export default class Father extends  React.Completed{
  constructor(props){
    super(props)
    this.father=React.createRef()
  }

  componentDidMount(){
    this.father.current.value='hahhaha'
  }

  render(){
    return <div ref={this.father}>
      this is div
    </div>
  }

}
