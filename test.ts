//声明一个 number 类型的变量
const num: number = 123

//声明一个函数
//两个参数类型分别是 number 和 any
function fn(arg1: number, arg2: any): void {
    //doSomething

}

fn(num, [1, 2, 3, 4])

//声明一个接口
interface IPerson {
    name: string,
    age: number,
    family: string[], //数组类型，里面的 item 是 string 类型
    sex?: '男' | '女' //?表示可选，值必须是'男','女',undefined
}

//利用 IPerson 接口去定义一个对象
const person: IPerson = {
    name: '小娟',
    age: 18,
    family: ['爸爸', '妈妈'],
}

//type 类似于 interface
type IPerson2 = {
    name: string,
    age: number,
    family: string[],
    sex?: '男' | '女'
}

const person2: IPerson2 = person

class Test {
    constructor() {

    }

    name='Jack'

    get age(){
        return '18'
    }

    set age(value){
        console.log('setter:'+value)
    }

    /*公开的 function*/
    // public say(){
    say(){

    }

    /*私有的 function*/
    private hide(){

    }

    //受保护的属性（子类中访问）
    protected protected(){

    }

    //静态属性
    static fn(){

    }

}

//==========练习==================================
interface Iargs {
    name: string,
    age: string,
}

function fun1(arg1: string, arg2: 'a' | 'b', arg3: Iargs) {
    //doSomething
}

fun1('a', 'b', {name: 'chen', age: '18'})










