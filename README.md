
# R2 File Browser Worker

这是一个部署在 Cloudflare Workers 上的轻量级文件浏览器，用于**浏览和下载**托管在 Cloudflare R2 存储桶中的文件列表。

该脚本实现了客户端分页和基本的速率限制，提供了统一、现代的 Web 界面。

## ✨ 主要特性

*   **R2 文件列表**：自动列出 R2 存储桶中的所有对象（文件）。
*   **下载支持**：点击文件名直接触发文件下载。
*   **客户端分页**：使用 JavaScript 实现分页，提高响应速度。
*   **速率限制 (可选)**：通过 Cloudflare KV 命名空间实现基于 IP 的请求频率限制。

## 🚀 部署指南 (纯 Cloudflare Dashboard)

本指南假设您已经拥有一个 Cloudflare 账户，并且已经创建了 **R2 存储桶**和一个 **KV 命名空间**（KV 是可选的）。

### 步骤 1: 准备 R2 存储桶和 KV 命名空间

1.  **R2 存储桶 (必需)**：
    *   在 Cloudflare Dashboard 中，导航到 **R2** -> **存储桶 (Buckets)**。
    *   创建一个新的存储桶，例如命名为 `FILES`。
    *   将您想要浏览的文件上传到此存储桶中。
    *   **重要**：记下此存储桶的名称（例如 `FILES`）。

2.  **KV 命名空间 (推荐)**：
    *   在 Cloudflare Dashboard 中，导航到 **Workers & Pages** -> **KV** -> **命名空间 (Namespaces)**。
    *   创建一个新的命名空间，例如命名为 `RATE_LIMITER`。
    *   **重要**：记下此 KV 命名空间的 **ID** 和 **名称**（例如 `RATE_LIMITER`）。

### 步骤 2: 创建 Worker 并配置代码与绑定

1.  在 Cloudflare Dashboard 中，导航到 **Workers & Pages**，点击 **创建应用程序 (Create application)** -> **创建 Worker (Create Worker)**。
2.  为您的 Worker 命名（例如 `r2-file-browser`）。
3.  进入 Worker 的 **代码 (Code)** 选项卡。
4.  **粘贴完整 Worker 脚本**：将最终的 Worker 脚本代码**完整地**粘贴到编辑器中，替换所有默认内容。
5.  **修改 Worker 代码中的配置常量**：
    *   在代码的顶部找到以下常量：
        ```javascript
        const BUCKET_BINDING_NAME = "FILES";          // 对应 R2 存储桶的绑定名称
        const KV_BINDING_NAME = "RATE_LIMITER";       // 对应 KV 命名空间的绑定名称
        ```
    *   将 `"FILES"` 和 `"RATE_LIMITER"` 替换为您在 **步骤 1** 中实际创建的 **R2 存储桶名称**和 **KV 命名空间名称**。
6.  **配置绑定 (Bindings)**：
    *   切换到 Worker 的 **设置 (Settings)** 选项卡。
    *   **R2 绑定**：点击 **添加绑定 (Add Binding)**。
        *   **名称 (Name)**：输入您在第 5 步中设置的 `BUCKET_BINDING_NAME` 的值（例如 `FILES`）。
        *   **R2 存储桶 (R2 Bucket)**：选择您在步骤 1 中创建的 R2 存储桶。
    *   **KV 绑定**：点击 **添加绑定 (Add Binding)**。
        *   **名称 (Name)**：输入您在第 5 步中设置的 `KV_BINDING_NAME` 的值（例如 `RATE_LIMITER`）。
        *   **命名空间 (Namespace)**：选择您在步骤 1 中创建的 KV 命名空间。
7.  **部署**：点击 **部署 (Deploy)** 按钮以保存配置并上线 Worker。

访问您已配置为处理相应路径的 URL 即可查看 R2 文件列表。
