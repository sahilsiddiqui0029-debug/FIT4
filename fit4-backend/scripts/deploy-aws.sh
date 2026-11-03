#!/bin/bash
set -e

# ========================================================
# AWS India-Health-SaaS Deployment Script (ap-south-1)
# ========================================================

REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="india-health-saas-repo"
SERVICE_ARN="arn:aws:apprunner:${REGION}:${ACCOUNT_ID}:service/india-health-saas-api"

echo "🚀 Starting Deployment to AWS Mumbai..."

echo "1/3 Authenticating with Elastic Container Registry (ECR)..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

echo "2/3 Building and Pushing Docker Image..."
# Build the production image using the Dockerfile
docker build -t $ECR_REPO --platform linux/amd64 .

# Tag and Push
docker tag $ECR_REPO:latest $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO:latest
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO:latest

echo "3/3 Updating App Runner Service..."
# App Runner is configured in Terraform to auto-deploy on ECR pushes.
# The command below safely triggers it manually in case auto-deploy was skipped.
aws apprunner start-deployment --service-arn $SERVICE_ARN --region $REGION || echo "Deployment triggered via ECR push automatically."

echo "✅ Deployment push completed! Check the AWS App Runner console for provisioning status."
