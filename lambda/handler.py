import json
import boto3
import uuid
import time
import os
from datetime import datetime

# Initialize S3 client using environment variables
s3_client = boto3.client('s3', region_name=os.environ['REGION'])

# Read configuration from environment
BUCKET_NAME = os.environ['BUCKET_NAME']
EXPIRE_SECONDS = int(os.getenv('SIGNED_URL_EXPIRE', 120))  # Default 120s

def lambda_handler(event, context):
    """
    Generates a pre-signed PUT URL for secure image upload to S3.
    Expects POST with JSON body: { "fileName": "<optional>", "contentType": "image/png" }
    Returns: { "url": "<signedUrl>", "key": "<objectKey>" }
    """
    try:
        # Parse incoming JSON body
        body = json.loads(event.get('body', '{}'))
        content_type = body.get('contentType', '')
        file_name = body.get('fileName', '')

        # Validate contentType — must start with 'image/'
        if not content_type.startswith('image/'):
            return {
                'statusCode': 400,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                'body': json.dumps({
                    'error': 'Invalid contentType. Must start with "image/".'
                })
            }

        # Validate allowed image types (optional but recommended)
        allowed_types = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
        if content_type not in allowed_types:
            return {
                'statusCode': 400,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                'body': json.dumps({
                    'error': f'Unsupported image type: {content_type}. Allowed: {", ".join(allowed_types)}'
                })
            }

        # Generate safe, unique object key
        timestamp = int(time.time())
        random_suffix = str(uuid.uuid4())[:6]
        ext = content_type.split('/')[-1]  # e.g., 'png' from 'image/png'
        object_key = f"uploads/{timestamp}-{random_suffix}.{ext}"

        # Generate pre-signed PUT URL
        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': BUCKET_NAME,
                'Key': object_key,
                'ContentType': content_type
            },
            ExpiresIn=EXPIRE_SECONDS,
            HttpMethod='PUT'
        )

        # Return signed URL and object key
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps({
                'url': presigned_url,
                'key': object_key
            })
        }

    except Exception as e:
        # Log error (visible in CloudWatch)
        print(f"Error generating presigned URL: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps({
                'error': 'Internal server error. Failed to generate upload URL.'
            })
        }