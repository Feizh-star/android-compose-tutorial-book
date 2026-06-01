# 复刻 Android 开发文档（初级）到本地并加个一目了然的目录

[源文档地址](https://developer.android.com/courses/android-basics-compose/course?hl=zh-cn)
文档内容很不错，但是目录结构严重阻碍初学者反复查阅，故决定复刻到本地并加个一目了然的目录。

## 工作流程：

### 1. 抓取文档目录

把源文档地址交给Claude code，大致跟它描述文档菜单结构，描述想要生成的菜单结构，生成一个menu.md目录，要强调生成的markdown多级列表格式为：


- [title](url)
  - [title](url)
    - [title](url)
- [title](url)
  - [title](url)
- [title](url)



### 2. 批量下载单页

这一步是批量“查看网页源代码 -> 保存html文件到本地”

运行命令：

```
node tools/fetch-source/fetch-all.js
```

默认读取menu.md，然后直接输出到node执行目录，可通过--input和--output指定输入输出

如果要处理单个：

```
node tools/fetch-source/fetch-single.js "url" "target"
```

> 此时，下载下来的html里面引用的静态资源依然是互联网资源

### 3. 下载静态资源

> 注意网络，如果你打开在线文档需要代理，那下载静态资源时也要开启代理，脚本会自动读取系统代理，也可以手动配置

html动态加载的图片、脚本、字体、样式等等，交给：

```
node tools/localize-docs-batch.js --source docs --output-root docs-locate
```

如果要处理单个：

```
node tools/localize-docs-batch.js --from "path relative to --source" --limit 1
```

> 此时，所有静态资源都已经下载本地

### 4. 生成菜单

**这一步因具体的网站而异，由AI读取样例html文档分析并生成构建脚本**

运行构建脚本，根据html的代码规律，生成菜单：

```
node tools/build-readable-docs.js
```

这一步只是处理本地代码，不依赖网络，速度很快，所以没必要单个处理，即时你想处理某一个，也可以直接全部处理一遍

不过你依然可以添加限制个数，主要用来测试处理效果，例如处理前10个看看效果：

```
node tools/build-readable-docs.js --limit 10 --output docs-locate\readable-test
```

