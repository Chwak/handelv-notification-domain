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

export interface OrderCreatedConsumerLambdaConstructProps {
  environment: string;
  regionCode: string;
  eventBus: events.IEventBus;
  notificationsTable: dynamodb.ITable;
  outboxTable: dynamodb.ITable;
  removalPolicy?: RemovalPolicy;
}

export class OrderCreatedConsumerLambdaConstruct extends Construct {
  public readonly function: lambda.IFunction;
  public readonly queue: sqs.IQueue;

  constructor(scope: Construct, id: string, props: OrderCreatedConsumerLambdaConstructProps) {
    super(scope, id);

    this.queue = new sqs.Queue(this, 'OrderCreatedConsumerQueue', {
      queueName: `${props.environment}-${props.regionCode}-notification-order-created-consumer-queue`,
      visibilityTimeout: Duration.seconds(180),
      retentionPeriod: Duration.days(4),
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
    });

    this.function = new lambdaNodeJs.NodejsFunction(this, 'OrderCreatedConsumerFunction', {
      functionName: `${props.environment}-${props.regionCode}-notification-order-created-consumer`,
      entry: `${__dirname}/../../../functions/lambda/event-consumer/order-created-consumer-lambda.ts`,
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

    new logs.LogGroup(this, 'OrderCreatedConsumerLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-notification-order-created-consumer`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
    });

    props.notificationsTable.grantReadWriteData(this.function);
    props.outboxTable.grantReadWriteData(this.function);

    this.function.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      })
    );

    const orderCreatedRule = new events.Rule(this, 'OrderCreatedRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['hand-made.order-domain'],
        detailType: ['order.created.v1'],
      },
    });

    orderCreatedRule.addTarget(new targets.SqsQueue(this.queue));
  }
}
