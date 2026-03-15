import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface UpdatePreferencesLambdaConstructProps {
  environment: string;
  regionCode: string;
  notificationPreferencesTable: dynamodb.ITable;
  removalPolicy?: cdk.RemovalPolicy;
}

export class UpdatePreferencesLambdaConstruct extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: UpdatePreferencesLambdaConstructProps) {
    super(scope, id);

    const role = new iam.Role(this, 'UpdatePreferencesLambdaRole', {
      roleName: `${props.environment}-${props.regionCode}-notification-domain-update-preferences-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Update Preferences Lambda',
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
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${props.environment}-${props.regionCode}-notification-domain-update-preferences-lambda*`,
              ],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem'],
              resources: [props.notificationPreferencesTable.tableArn],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'UpdatePreferencesLogGroup', {
      logGroupName: `/aws/lambda/${props.environment}-${props.regionCode}-notification-domain-update-preferences-lambda`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCodePath = path.join(__dirname, '../../../../functions/lambda/notification/update-preferences/update-preferences-lambda.ts');
    this.function = new NodejsFunction(this, 'UpdatePreferencesFunction', {
      functionName: `${props.environment}-${props.regionCode}-notification-domain-update-preferences-lambda`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      entry: lambdaCodePath,
      role,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.DISABLED,
      logGroup,
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'node22',
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        ENVIRONMENT: props.environment,
        REGION_CODE: props.regionCode,
        NOTIFICATION_PREFERENCES_TABLE_NAME: props.notificationPreferencesTable.tableName,
        LOG_LEVEL: props.environment === 'prod' ? 'ERROR' : 'INFO',
      },
      description: 'Update user notification preferences',
    });

    props.notificationPreferencesTable.grantReadWriteData(this.function);


    if (props.removalPolicy) {
      this.function.applyRemovalPolicy(props.removalPolicy);
    }
  }
}
