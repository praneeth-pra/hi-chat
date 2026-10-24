import { describe, expect, it } from 'vitest'
import { questionEffort } from '../questionEffort'

describe('thinking level per question', () => {
  it.each([
    'What is an AMI?',
    'What is the difference between EC2 and Fargate?',
    'Can you tell me what is a VPC?',
    'Define idempotency.',
    'Full form of IAM?',
    'Is S3 a global service?',
    'Name some AWS storage services.',
    'Explain Kubernetes pods.',
  ])('low: %s', (q) => expect(questionEffort(q)).toBe('low'))

  it.each([
    'How would you design a highly available multi-region setup?',
    'Can you let me know how we can migrate an EC2 instance from one region to another region?',
    'If you want to upgrade an AMI, how is the process that is usually followed? Can you brief out the process in detail?',
    'Why would you choose ECS over EKS?',
    'What are the trade-offs between RDS and DynamoDB?',
    'My pod is in CrashLoopBackOff, how do I debug it?',
    'Write a function to reverse a linked list.',
    'What is the time complexity of quicksort?',
    'Walk me through a CI/CD pipeline you built.',
    'Tell me about a scenario where a deployment failed and what you did, and also how you prevented it from happening again in the future?',
    'Here is my code:\nconst x = () => {}',
    '',
  ])('medium: %s', (q) => expect(questionEffort(q)).toBe('medium'))
})
