import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface MarkNotificationReadLambdaConstructProps {
  environment: string;
  regionCode: string;
  notificationsTable: dynamodb.ITable;
  removalPolicy?: cdk.RemovalPolicy;
}

export class MarkNotificationReadLambdaConstruct extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: MarkNotificationReadLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'MarkNotificationReadLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-notification-domain-mark-notification-read-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Mark Notification Read Lambda',
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
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-notification-domain-mark-notification-read-lambda*`,
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:UpdateItem'],
              resources: [props.notificationsTable.tableArn],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'MarkNotificationReadLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-notification-domain-mark-notification-read-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/notification/mark-notification-read');
    this.function = new lambda.Function(this, 'MarkNotificationReadFunction', {
      functionName: `${props.environment}-${props.regionCode}-notification-domain-mark-notification-read-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'mark-notification-read-lambda.handler',
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
        LOG_LEVEL: props.environment === 'prod' ? 'ERROR' : 'INFO',
      },
      description: 'Mark notification as read',
    });

    props.notificationsTable.grantWriteData(this.function);


    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}
