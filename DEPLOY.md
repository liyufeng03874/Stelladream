# Stelladream 部署指南

本文档详细说明如何将Stelladream部署到生产环境。

## 📋 部署前检查清单

- [ ] 服务器环境满足要求
- [ ] Elasticsearch已安装并运行
- [ ] 模型文件已下载
- [ ] 域名和SSL证书已配置
- [ ] 防火墙规则已设置

## 🖥️ 服务器要求

### 最低配置

- **CPU**: 4核
- **内存**: 16GB
- **存储**: 100GB SSD
- **网络**: 10Mbps

### 推荐配置

- **CPU**: 8核以上
- **内存**: 32GB以上
- **GPU**: NVIDIA GPU (12GB+ VRAM) 用于模型推理
- **存储**: 200GB+ SSD
- **网络**: 100Mbps

### 软件环境

- **操作系统**: Ubuntu 20.04 LTS / 22.04 LTS
- **Python**: 3.10+
- **Node.js**: 18.x LTS
- **Elasticsearch**: 8.x
- **Nginx**: 1.18+
- **CUDA**: 11.8+ (可选，GPU加速)

## 🔧 详细部署步骤

### 1. 系统准备

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装基础工具
sudo apt install -y git curl wget vim build-essential

# 安装Python 3.10
sudo apt install -y python3.10 python3.10-venv python3-pip

# 安装Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
python3.10 --version
node --version
npm --version
```

### 2. 安装Elasticsearch

```bash
# 导入GPG密钥
wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg

# 添加APT仓库
echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" | sudo tee /etc/apt/sources.list.d/elastic-8.x.list

# 安装
sudo apt update
sudo apt install -y elasticsearch

# 配置
sudo vim /etc/elasticsearch/elasticsearch.yml
```

配置内容：

```yaml
cluster.name: stelladream-cluster
node.name: node-1
network.host: 0.0.0.0
http.port: 9200
xpack.security.enabled: false  # 生产环境建议启用
```

```bash
# 启动服务
sudo systemctl enable elasticsearch
sudo systemctl start elasticsearch

# 验证
curl http://localhost:9200
```

### 3. 部署后端

```bash
# 创建应用目录
sudo mkdir -p /opt/stelladream
cd /opt/stelladream

# 克隆项目
git clone <repository-url> .

# 创建Python虚拟环境
python3.10 -m venv venv
source venv/bin/activate

# 安装依赖
cd backend
pip install -r requirements.txt

# 下载模型文件（如果不存在）
mkdir -p /opt/models
cd /opt/models

# BGE-large-zh-v1.5
git clone https://huggingface.co/BAAI/bge-large-zh-v1.5

# BGE-reranker-large
git clone https://huggingface.co/BAAI/bge-reranker-large

# 配置文件
cd /opt/stelladream
cp shared/config.json.example shared/config.json
vim shared/config.json
```

配置示例：

```json
{
  "elasticsearch": {
    "host": "http://localhost:9200",
    "index": "unified_rag"
  },
  "models": {
    "embedder_path": "/opt/models/bge-large-zh-v1.5",
    "reranker_path": "/opt/models/bge-reranker-large"
  }
}
```

```bash
# 导入数据到Elasticsearch
python import_data.py

# 测试后端
python server.py
# 访问 http://localhost:8000 验证
```

### 4. 部署前端

```bash
cd /opt/stelladream/frontend

# 安装依赖
npm install

# 构建生产版本
npm run build

# 构建产物在 dist/ 目录
ls -la dist/
```

### 5. 配置Nginx

```bash
# 安装Nginx
sudo apt install -y nginx

# 创建配置文件
sudo vim /etc/nginx/sites-available/stelladream
```

Nginx配置：

```nginx
# 上游后端服务
upstream stelladream_backend {
    server 127.0.0.1:8000;
}

server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /opt/stelladream/frontend/dist;
        try_files $uri $uri/ /index.html;
        
        # 缓存策略
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # 后端API代理
    location /api/ {
        proxy_pass http://stelladream_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置（搜索需要较长时间）
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    # 客户端最大上传大小
    client_max_body_size 10M;

    # Gzip压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;
}
```

```bash
# 启用站点
sudo ln -s /etc/nginx/sites-available/stelladream /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启Nginx
sudo systemctl restart nginx
```

### 6. 配置SSL (推荐)

```bash
# 安装Certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取SSL证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo systemctl enable certbot.timer
```

### 7. 配置Systemd服务

创建后端服务：

```bash
sudo vim /etc/systemd/system/stelladream-backend.service
```

服务配置：

```ini
[Unit]
Description=Stelladream Backend Service
After=network.target elasticsearch.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/stelladream/backend
Environment="PATH=/opt/stelladream/venv/bin"
ExecStart=/opt/stelladream/venv/bin/python server.py
Restart=always
RestartSec=10

# 资源限制
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
# 重载配置
sudo systemctl daemon-reload

# 启动服务
sudo systemctl enable stelladream-backend
sudo systemctl start stelladream-backend

# 检查状态
sudo systemctl status stelladream-backend

# 查看日志
sudo journalctl -u stelladream-backend -f
```

### 8. 配置防火墙

```bash
# 允许HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 允许SSH（如果需要）
sudo ufw allow 22/tcp

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

## 🔍 验证部署

### 检查各组件状态

```bash
# Elasticsearch
curl http://localhost:9200/_cluster/health?pretty

# 后端服务
curl http://localhost:8000/

# Nginx
sudo systemctl status nginx

# 前端（通过域名）
curl -I http://your-domain.com
```

### 测试搜索功能

```bash
curl -X POST http://your-domain.com/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"测试查询"}'
```

## 📊 监控与日志

### 日志位置

- **后端日志**: `sudo journalctl -u stelladream-backend -f`
- **Nginx访问日志**: `/var/log/nginx/access.log`
- **Nginx错误日志**: `/var/log/nginx/error.log`
- **Elasticsearch日志**: `/var/log/elasticsearch/`

### 性能监控

```bash
# 安装监控工具
sudo apt install -y htop iotop nethogs

# 实时监控
htop

# GPU监控（如果有）
nvidia-smi -l 1
```

### 设置日志轮转

```bash
sudo vim /etc/logrotate.d/stelladream
```

配置：

```
/var/log/stelladream/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
}
```

## 🔧 维护与更新

### 更新代码

```bash
cd /opt/stelladream

# 备份当前版本
sudo cp -r . ../stelladream-backup-$(date +%Y%m%d)

# 拉取最新代码
git pull

# 更新后端依赖
source venv/bin/activate
cd backend
pip install -r requirements.txt

# 重新构建前端
cd ../frontend
npm install
npm run build

# 重启服务
sudo systemctl restart stelladream-backend
sudo systemctl reload nginx
```

### 备份策略

```bash
# 创建备份脚本
sudo vim /opt/backup-stelladream.sh
```

备份脚本：

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份代码
tar czf $BACKUP_DIR/stelladream-code-$DATE.tar.gz /opt/stelladream

# 备份Elasticsearch数据
curl -X POST "localhost:9200/_snapshot/stelladream_backup/snapshot_$DATE?wait_for_completion=true"

# 清理7天前的备份
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
```

```bash
# 添加执行权限
sudo chmod +x /opt/backup-stelladream.sh

# 添加定时任务（每天凌晨2点）
sudo crontab -e
```

添加：

```
0 2 * * * /opt/backup-stelladream.sh >> /var/log/stelladream-backup.log 2>&1
```

## 🐛 故障排查

### 后端无法启动

```bash
# 查看详细日志
sudo journalctl -u stelladream-backend -n 100 --no-pager

# 检查端口占用
sudo netstat -tlnp | grep 8000

# 手动启动测试
cd /opt/stelladream/backend
source ../venv/bin/activate
python server.py
```

### Elasticsearch连接失败

```bash
# 检查服务状态
sudo systemctl status elasticsearch

# 测试连接
curl http://localhost:9200

# 查看日志
sudo tail -f /var/log/elasticsearch/stelladream-cluster.log
```

### 前端加载失败

```bash
# 检查Nginx配置
sudo nginx -t

# 查看错误日志
sudo tail -f /var/log/nginx/error.log

# 检查文件权限
ls -la /opt/stelladream/frontend/dist/
```

## 🔐 安全建议

1. **启用Elasticsearch安全**
   - 配置用户认证
   - 使用TLS加密通信
   - 限制网络访问

2. **使用HTTPS**
   - 强制HTTPS重定向
   - 配置HSTS头
   - 使用强加密套件

3. **限制API访问**
   - 配置速率限制
   - 实现IP白名单
   - 添加API认证

4. **定期更新**
   - 及时更新依赖包
   - 关注安全漏洞
   - 定期审计日志

## 📞 获取帮助

如遇到部署问题，请：

1. 查看日志文件
2. 检查系统资源（CPU、内存、磁盘）
3. 验证网络连接
4. 提issue并附上错误信息

---

**部署文档版本**: 1.0.0  
**最后更新**: 2026-07-11
