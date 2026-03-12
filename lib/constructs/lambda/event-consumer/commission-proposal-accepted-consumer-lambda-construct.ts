import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodeJs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

export interface CommissionProposalAcceptedConsumerLambdaConstructProps {
  environment: string;
  regionCode: string;
  eventBus: events.IEventBus;
  notificationsTable: dynamodb.ITable;
  outboxTable: dynamodb.ITable;
  removalPolicy?: RemovalPolicy;
}

export class CommissionProposalAcceptedConsumerLambdaConstruct extends Construct {
  public readonly function: lambda.IFunction;
  public readonly queue: sqs.IQueue;

  constructor(scope: Construct, id: string, props: CommissionProposalAcceptedConsumerLambdaConstructProps) {
    super(scope, id);

    this.queue = new sqs.Queue(this, 'CommissionProposalAcceptedConsumerQueue', {
      queueName: `${props.environment}-${props.regionCode}-notification-commission-proposal-accepted-consumer-queue`,
      visibilityTimeout: Duration.seconds(180),
      retentionPeriod: Duration.days(4),
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
    });

    this.function = new lambdaNodeJs.NodejsFunction(this, 'CommissionProposalAcceptedConsumerFunction', {
      functionName: `${props.environment}-${props.regionCode}-notification-commission-proposal-accepted-consumer`,
      entry: `${__dirname}/../../../functions/lambda/event-consumer/commission-proposal-accepted-consumer-lambda.ts`,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: {
        NOTIFICATIONS_TABLE_NAME: props.notificationsTable.tableName,
        OUTBOX_TABLE_NAME: props.outboxTable.tableName,
        EVENT_BUS_NAME: props.eventBus.eventBusName,
        ENVIRONMENT: props.environment,
        REGION_CODE: props.regionCode,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        minify: false,
        sourceMap: false,
      },
    });

    new logs.LogGroup(this, 'CommissionProposalAcceptedConsumerLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-notification-commission-proposal-accepted-consumer`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
    });

    props.notificationsTable.grantReadWriteData(this.function);
    props.outboxTable.grantReadWriteData(this.function);

    this.function.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    const rule = new events.Rule(this, 'CommissionProposalAcceptedRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['hand-made.maker-domain'],
        detailType: ['commission.proposal.accepted.v1'],
      },
    });

    rule.addTarget(new targets.SqsQueue(this.queue));
  }
}
