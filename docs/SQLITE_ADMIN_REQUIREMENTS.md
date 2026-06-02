# SQLite 数据库管理（Admin）需求说明

## 1. 背景与目标

项目在 `DATA_STORE=vultr_sqlite` 时通过 `SQLITE_API_URL` 连接 Vultr 上的 **data-api**，底层为单文件 SQLite（`schema.sql`）。

**目标**：在管理后台提供 **SQLite 数据库管理**，对接**运行时同一套** SQLite（与 API 进程配置的 `SQLITE_API_URL` 一致），支持：

- 浏览全部业务表
- 按主键 / ID 类字段查询
- 安全地修改行内字段（含 `data_json`）

## 2. 非目标（V1 不做）

- 任意 SQL 控制台（防注入与误删）
- `DROP` / `PRAGMA` / `ATTACH` / 全表 `DELETE`
- 跨表 JOIN、复杂聚合
- 直连服务器文件系统改 `.db`（必须经 data-api）
- `DATA_STORE=firestore` 模式下的表管理（返回 400 说明）
- 已废弃的 Firestore 一键运维任务（已从 Admin 移除；如需批量清理请用 `server/scripts/` 或 SQLite 页手工改行）

## 3. 架构

```
Admin UI (SqliteDatabasePage)
    → Cloud Run API (/api/admin/sqlite/*, JWT)
        → sqlite-db-admin.service (白名单表/列、参数化 SQL)
            → sql-client → data-api POST /v1/sql
                → better-sqlite3 (WAL)
```

**原则**：所有读写经 **参数化** SQL；表名/列名仅允许 `[a-zA-Z0-9_]` 且存在于 `pragma_table_info`；过滤字段仅限主键与 ID 类列。

## 4. 功能需求

### 4.1 连接信息

- 展示：`dataStore`、脱敏后的 API 地址、表数量、可选 `game_catalog` 行数（health 探针）
- 非 `vultr_sqlite` 时整页提示不可用

### 4.2 表列表

- 来源：`sqlite_master`，排除 `sqlite_%`
- 展示：表名、列数、主键列、是否含 `data_json`
- 点击表进入行浏览

### 4.3 表结构

- 来源：`pragma_table_info(table)`
- 展示：列名、类型、NOT NULL、默认值、是否主键（`pk > 0`）

### 4.4 查询（ID 类）

- **可筛列**（表内实际存在才显示）：
  - 主键列（`pk` 来自 pragma）
  - 命名规则：`id`、`appid`、`doc_id`、`key`、`collection`、`country_code`、`steam_id`、`game_id`，或以 `_id` 结尾
- 条件：等值匹配；多列 AND；空则分页拉取
- 分页：`limit` 默认 50，最大 100；`offset` 最大 100_000
- 排序：有主键则按主键 ASC，否则 `rowid`

### 4.5 行编辑

- 按主键定位一行；复合主键（如 `documents`）需同时传各 PK 列
- 可改列：除主键外所有列；`data_json` / `*_json` 校验合法 JSON 字符串
- `UPDATE` 仅 SET 提交的列；返回 `changes`
- 删除：V1 可选；若做需二次确认 + 仅允许有主键的表

## 5. 安全与审计

| 项 | 要求 |
|----|------|
| 认证 | 现有 Admin JWT |
| 表名 | 白名单 = 当前库 `sqlite_master` 中的表 |
| 列名 | 必须出现在 `pragma_table_info` |
| SQL | 禁止拼接用户输入为标识符；值一律 `?` 绑定 |
| 写操作 | 建议记录 `logger.info`：表、主键、操作者（从 req.admin） |
| data-api | 继续禁止 `DROP`/`PRAGMA` 语句；用 `pragma_table_info()` 表函数 |

## 6. API 契约（Admin）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/sqlite/info` | 连接与统计 |
| GET | `/api/admin/sqlite/tables` | 表列表 + 元数据 |
| GET | `/api/admin/sqlite/tables/:table/schema` | 列定义 |
| GET | `/api/admin/sqlite/tables/:table/rows` | Query: `limit`,`offset`, 及各可筛列 |
| PATCH | `/api/admin/sqlite/tables/:table/rows` | Body: `{ primaryKey, patch }` |

## 7. UI 交互（Admin）

- 菜单：**SQLite 数据库**（图标 Database）
- 路由：`/sqlite-database`
- 布局：左表列表 + 右（筛选 + 表格 + 编辑抽屉）
- `data_json`：等宽字体 JSON 编辑；保存前 `JSON.parse` 校验
- 长文本列：表格 ellipsis + 编辑弹窗全文

## 8. 验收标准

1. `vultr_sqlite` 环境下可列出 `schema.sql` 中全部表（≥20）
2. `game_catalog` 按 `appid` 精确查出一行并可改 `name` 或 `data_json` 片段后读回一致
3. `documents` 复合主键可查询与更新
4. 非法表名 / 列名 / 过滤字段返回 400
5. `DATA_STORE=firestore` 时接口 400，页面提示切换存储模式

## 9. 后续迭代（可选）

- 行级删除 + 回收站
- `data_json` 树形编辑器
- 导出 CSV / 单表备份
- 只读副本库只读模式
- 操作审计表持久化
