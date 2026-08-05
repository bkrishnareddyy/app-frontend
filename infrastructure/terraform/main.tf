# Qubere Infrastructure as Code - Google Cloud Platform / AWS Provisioning
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

variable "gcp_project_id" {
  type    = string
  default = "qubere-production"
}

variable "gcp_region" {
  type    = string
  default = "us-west1"
}
