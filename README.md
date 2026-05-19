# Prometheus Targets UI

本项目提供一个本地 Web UI，用于可视化维护 Prometheus file_sd 使用的 `targets.json`。

## 启动

```powershell
python app.py
```

打开：

```text
http://127.0.0.1:8000/
```

## 功能

- 查看、搜索服务器 targets
- 新增、编辑、复制、删除服务器
- 动态添加、删除任意 labels
- 保存前校验 Prometheus file_sd JSON 结构
- 每次写入前自动备份到 `backups/`
- 在 UI 中查看备份内容，并可从备份恢复 `targets.json`

## Docker Compose 部署

```bash
docker compose up -d --build
```

启动前请确认服务器上已经存在：

```text
/compose/prometheus-grafana/prometheus/targets.json
```

访问：

```text
http://服务器IP:8000/
```

`docker-compose.yml` 只会把服务器上的 `/compose/prometheus-grafana/prometheus/targets.json` 挂载到容器内 `/data/targets.json`。程序只能修改这个文件，不会挂载或写入 Prometheus 目录下的其他文件。

备份文件写入 Docker 命名卷 `prometheus-target-ui-backups`，不会写入 `/compose/prometheus-grafana/prometheus` 目录。
