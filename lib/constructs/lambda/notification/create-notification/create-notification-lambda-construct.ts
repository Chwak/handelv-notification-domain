import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CreateNotificationLambdaConstructProps {
  environment: string;
  regionCode: string;
  notificationsTable: dynamodb.ITable;
  notificationTopic?: sns.ITopic;
  removalPolicy?: cdk.RemovalPolicy;
}

export class CreateNotificationLambdaConstruct extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: CreateNotificationLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'CreateNotificationLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-notification-domain-create-notification-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Create Notification Lambda',
      inlinePolicies: {
        CloudWatchLogsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: [
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-notification-domain-create-notification-lambda*`,
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:PutItem'],
              resources: [props.notificationsTable.tableArn],
            }),
          ],
        }),
        ...(props.notificationTopic
          ? {
              SNSPublishAccess: new iam.PolicyDocument({
                statements: [
                  new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['sns:Publish'],
                    resources: [props.notificationTopic.topicArn],
                  }),
                ],
              }),
            }
          : {}),
      },
    });

    const logGroup = new logs.LogGroup(this, 'CreateNotificationLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-notification-domain-create-notification-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/notification/create-notification');
    this.function = new lambda.Function(this, 'CreateNotificationFunction', {
      functionName: `${props.environment}-${props.regionCode}-notification-domain-create-notification-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'create-notification-lambda.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      role,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.DISABLED,
      logGroup,
      environment: {
        ENVIRONMENT: props.environment,
        REGION_CODE: props.regionCode,
        NOTIFICATIONS_TABLE_NAME: props.notificationsTable.tableName,
        ...(props.notificationTopic && { NOTIFICATION_TOPIC_ARN: props.notificationTopic.topicArn }),
        LOG_LEVEL: props.environment === 'prod' ? 'ERROR' : 'INFO',
      },
      description: 'Create a notification',
    });

    props.notificationsTable.grantWriteData(this.function);

    if (props.notificationTopic) {
      props.notificationTopic.grantPublish(this.function);
    }


    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}
