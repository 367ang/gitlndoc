/// <reference types="vite/client" />

// Vite 客户端类型：为 `*.module.css` 提供 `{ [key: string]: string }` 的类型声明。
// 缺它时 `tsc --noEmit` 会对所有 CSS Modules 导入报 TS2307。
// 该文件仅作类型引用，无运行时代码。
