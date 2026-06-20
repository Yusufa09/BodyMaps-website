# Backend

#### Create Conda Environment
```
conda create -n PanTS_backend python=3.11
conda activate PanTS_backend
```

#### Set up environment backend
```
cd flask-server
touch .env // makes .env file
nano .env
```

Inside .env file:
```
BASE_PATH=/

PANTS_PATH=/folder/where/PanTS

USE_SSL=false
```

Run backend:

```
pip install -r requirements.txt
python app.py
```

# Frontend

```
cd PanTS-Demo
touch .env
nano .env
```

Inside .env:
```
VITE_API_BASE=http://localhost:5001
```

#### Run frontend

```
npm install
npm run dev
```

# Deploying Updates to the Server
---

After pushing changes, SSH into the server and run the following.

```
ssh visitor@bdmap1.wse.jhu.edu
```

#### 1. Pull latest changes
```
cd /home/visitor/PanTS-Viewer
git fetch
git pull
```

#### 2. Rebuild the frontend
```
cd /home/visitor/PanTS-Viewer/PanTS-Demo && npm run build
```

#### 3. Restart the backend
```
# Kill the old gunicorn process
kill $(pgrep -f "gunicorn.*app:app")

# Start a new gunicorn process
nohup /home/visitor/.conda/envs/PanTS_backend/bin/gunicorn \
  --worker-class gthread --workers 1 --threads 8 \
  --bind 127.0.0.1:8000 --timeout 3600 \
  --chdir /home/visitor/PanTS-Viewer/flask-server \
  app:app > /tmp/gunicorn.log 2>&1 &
echo "PID: $!"
```

#### 4. Verify the backend is running
```
sleep 3 && curl http://127.0.0.1:8000/api/ping
```

Logs are written to `/tmp/gunicorn.log`.
