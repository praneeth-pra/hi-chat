import { describe, it, expect } from 'vitest'
import { applyFixes, parseFixes } from '../dictationFixes'

describe('applyFixes', () => {
  it('fixes known mistakes as whole words, ignoring case', () => {
    expect(applyFixes('by using routers and rollbacks asset controls.')).toBe(
      'by using routers and role-based access controls.'
    )
    expect(applyFixes('a lot of Pinoops or cost')).toBe(
      'a lot of FinOps or cost'
    )
    expect(applyFixes('AWS EC 2, VPC, S 3 buckets')).toBe(
      'AWS EC2, VPC, S3 buckets'
    )
    expect(applyFixes('Is it 2 tire or 3 tire?')).toBe(
      'Is it 2-tier or 3-tier?'
    )
  })

  it('writes CI/CD and S3 however the engines spell them', () => {
    expect(applyFixes('Have you used CSCD or CI CD or CACD?')).toBe(
      'Have you used CI/CD or CI/CD or CI/CD?'
    )
    expect(applyFixes('a CICD pipeline with an S three bucket')).toBe(
      'a CI/CD pipeline with an S3 bucket'
    )
    expect(applyFixes('CI/CD stays')).toBe('CI/CD stays')
  })

  it('leaves other words alone', () => {
    expect(applyFixes('the S3 bucket and a tire shop')).toBe(
      'the S3 bucket and a tire shop'
    )
    expect(applyFixes('kubectl rollbacks')).toBe('kubectl rollbacks')
  })

  it('reads the list format, skipping comments', () => {
    const fixes = parseFixes('# note\nfoo bar => Baz\nbad line\n')
    expect(fixes).toHaveLength(1)
    expect(applyFixes('a Foo, bar b', fixes)).toBe('a Baz b')
  })

  it('fixes the AWS words every engine missed, only when AWS is being discussed', () => {
    expect(
      applyFixes('How can we run containers on ECS with forget launch type?')
    ).toBe('How can we run containers on ECS with Fargate launch type?')
    expect(applyFixes('I forget the name of that tool.')).toBe(
      'I forget the name of that tool.'
    )
    expect(
      applyFixes(
        'Can you tell me how we can use am I and also copy image function?'
      )
    ).toBe('Can you tell me how we can use AMI and also copy image function?')
    expect(
      applyFixes('If you want to upgrade an EMI, how is the process?')
    ).toBe('If you want to upgrade an AMI, how is the process?')
    expect(applyFixes('I pay an EMI on my loan.')).toBe(
      'I pay an EMI on my loan.'
    )
    expect(applyFixes('Am I right?')).toBe('Am I right?')
    expect(
      applyFixes('How to migrate AC institutions from one region to another?')
    ).toBe('How to migrate EC2 instances from one region to another?')
    expect(applyFixes('Is E case managed Kubernetes?')).toBe(
      'Is EKS managed Kubernetes?'
    )
    expect(applyFixes('upgrade an eCase cluster')).toBe(
      'upgrade an EKS cluster'
    )
  })

  it('reads context words after @, counting earlier fixes', () => {
    const fixes = parseFixes('EC 2 => EC2\nam I => AMI @ EC2, image')
    expect(applyFixes('copy the am I of an EC 2', fixes)).toBe(
      'copy the AMI of an EC2'
    )
    expect(applyFixes('am I late', fixes)).toBe('am I late')
  })

  it('fixes the cloud terms from 25 Oct, only in context', () => {
    expect(
      applyFixes(
        'Can you explain how Carpenter differs from cluster autoscaler in any case?'
      )
    ).toBe(
      'Can you explain how Karpenter differs from cluster autoscaler in EKS?'
    )
    expect(applyFixes('In any case, the deploy failed.')).toBe(
      'In any case, the deploy failed.'
    )
    expect(applyFixes('My carpenter fixed the door.')).toBe(
      'My carpenter fixed the door.'
    )
    expect(
      applyFixes(
        'How do you know a case with Azure CNI overlay and Selenium for network policies?'
      )
    ).toBe(
      'How do you know AKS with Azure CNI overlay and Cilium for network policies?'
    )
    expect(applyFixes('I automate tests with Selenium and Playwright.')).toBe(
      'I automate tests with Selenium and Playwright.'
    )
    expect(applyFixes('Amazon Kinesis Data Warehouse vs Event Hubs')).toBe(
      'Amazon Kinesis Data Firehose vs Event Hubs'
    )
    expect(applyFixes('Snowflake is a data warehouse')).toBe(
      'Snowflake is a data warehouse'
    )
    expect(
      applyFixes('connect an Azure virtual van to a transit gateway')
    ).toBe('connect an Azure Virtual WAN to a transit gateway')
    expect(applyFixes('AWS AIM Identity Center')).toBe(
      'AWS IAM Identity Center'
    )
    expect(
      applyFixes('Aurora serverless V 2 over Cosmos DB for postgress SQL')
    ).toBe('Aurora Serverless v2 over Cosmos DB for PostgreSQL')
  })
})
