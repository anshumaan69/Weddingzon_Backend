# Fixing 413 Payload Too Large (Nginx / CloudFront / AWS Amplify)

The error `413 Payload Too Large` is often caused by the reverse proxy (Nginx) or the CDN (CloudFront) rejecting the request before it even reaches your Node.js application.

Even though we have increased the Node.js limit to **100MB**, you must also configure your hosting environment.

## 1. NGINX Configuration (If using Nginx)
If you are running your own Nginx server (e.g., on EC2 or DigitalOcean), you need to increase `client_max_body_size`.

**File:** `/etc/nginx/nginx.conf`  
**Section:** `http`, `server`, or `location` block

```nginx
http {
    ...
    client_max_body_size 100M;
    ...
}
```

After changing, restart Nginx:
```bash
sudo service nginx restart
```

## 2. AWS Elastic Beanstalk (If using EB)
Create a config file in your source code: `.platform/nginx/conf.d/proxy.conf`

```nginx
client_max_body_size 100M;
```

## 3. AWS Amplify (If using Amplify Hosting)
If you are using AWS Amplify for the backend (which is rare for Express, but possible with invalidation rules):
- Amplify generally does not have a hard 1MB limit for API routes unless configured via CloudFront.

## 4. CloudFront (If using CloudFront)
If your API is behind CloudFront:
- CloudFront does NOT restrict file size by default (it supports up to 20GB).
- However, if you have a WAF (Web Application Firewall) attached, verify it doesn't have a size rule.

## 5. Kubernetes / Ingress (If applicable)
Add the annotation to your Ingress resource:
```yaml
nginx.ingress.kubernetes.io/proxy-body-size: "100m"
```
