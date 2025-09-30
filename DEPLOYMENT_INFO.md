# Deployment Information

**DO NOT COMMIT THIS FILE TO GIT**

## Production Environment

- **Host**: pet.kfamcloud.com
- **Access**: SSH with passwordless access, passwordless sudo to root
- **Container Runtime**: Podman under root
- **Container Management**: Portainer
- **Stack Name**: gct
- **Container Names**:  (from docker-compose.yml)

## Deployment Process

- **Repository**: GitHub with auto-deployment
- **CI/CD**: GitHub Actions triggers Portainer webhook for auto-deployment on push
- **Public URL**: https://srs.wandergeek.org/

## Container Management Commands

```bash
# SSH to production server
ssh pet.kfamcloud.com

# View container logs
sudo podman logs gct


# Container status via Portainer stack "gct"
```