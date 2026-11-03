provider "aws" {
  region = "ap-south-1"  # Mumbai Region
}

# --------------------------
# Redis Cluster (ElastiCache)
# --------------------------
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "india-health-saas-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379

  tags = {
    Project = "India-Health-SaaS"
  }
}

variable "db_password" {
  description = "Master password for the PostgreSQL RDS instance (injected via TF_VAR_db_password or SSM)"
  type        = string
  sensitive   = true
}

# --------------------------
# Database (RDS PostgreSQL)
# --------------------------
resource "aws_db_instance" "postgres" {
  identifier              = "india-health-saas-db"
  allocated_storage       = 20
  engine                  = "postgres"
  engine_version          = "15.4"
  instance_class          = "db.t3.micro"
  username                = "postgres"
  password                = var.db_password
  storage_encrypted       = true
  backup_retention_period = 7
  skip_final_snapshot     = false
  final_snapshot_identifier = "india-health-saas-db-final-snapshot"
  publicly_accessible     = false

  tags = {
    Project = "India-Health-SaaS"
  }
}

# --------------------------
# Container Registry (ECR)
# --------------------------
resource "aws_ecr_repository" "app_repo" {
  name                 = "india-health-saas-repo"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project = "India-Health-SaaS"
  }
}

# --------------------------
# Application Runner
# --------------------------
resource "aws_apprunner_service" "api_service" {
  service_name = "india-health-saas-api"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_access_role.arn
    }
    image_repository {
      image_identifier      = "${aws_ecr_repository.app_repo.repository_url}:latest"
      image_repository_type = "ECR"
      image_configuration {
        port = "3000"
        env = {
          NODE_ENV     = "production"
          REDIS_URL    = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
          DATABASE_URL = "postgresql://postgres:${var.db_password}@${aws_db_instance.postgres.endpoint}/india_health_saas?schema=public"
        }
      }
    }
    auto_deployments_enabled = true
  }

  instance_configuration {
    cpu    = "1 vCPU"
    memory = "2 GB"
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/health"
    healthy_threshold   = 1
    unhealthy_threshold = 5
    interval            = 10
    timeout             = 5
  }

  tags = {
    Project = "India-Health-SaaS"
  }
}

# IAM Role for App Runner to fetch from ECR
resource "aws_iam_role" "apprunner_access_role" {
  name = "apprunner-ecr-access-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "build.apprunner.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr_policy" {
  role       = aws_iam_role.apprunner_access_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}
