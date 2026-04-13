# Backend
---
### Create Conda Environment
```
conda create -n PanTS_backend python=3.11
conda activate PanTS_backend
```

### Set up environment backend
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
---
```
cd PanTS-Demo
touch .env
nano .env
```

Inside .env:
```
VITE_API_BASE=http://localhost:5001
```

### Run frontend
```
npm install
npm run dev
```
