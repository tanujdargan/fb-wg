#--CHANGE my_zone -------
#----------TERMINAL 1 ---------------
export my_zone=us-east1-c

REGION=${my_zone::-2}
export my_cluster=standard-cluster-1
source <(kubectl completion bash)
gcloud container clusters get-credentials $my_cluster --zone $my_zone
git clone https://github.com/GoogleCloudPlatform/training-data-analyst
ln -s ~/training-data-analyst/courses/ak8s/v1.1 ~/ak8s
cd ~/ak8s/GKE_Services/
kubectl apply -f dns-demo.yaml
kubectl exec -it dns-demo-1 -- /bin/bash

#---root@dns-demo-1 TERMINAL ----

apt-get update
apt-get install -y iputils-ping
ping dns-demo-2.dns-demo.default.svc.cluster.local

#---NEW TERMINAL - TERMINAL 2-----
export my_zone=us-east1

REGION=${my_zone::-2}
cd ~/ak8s/GKE_Services/
kubectl create -f hello-v1.yaml
kubectl get deployments
kubectl apply -f ./hello-svc.yaml
kubectl get service hello-svc

#--BACK TO TERMINAL 1 : ---root@dns-demo-1 TERMINAL ----
apt-get install -y curl
curl hello-svc.default.svc.cluster.local


#---BACK TO - TERMINAL 2-----

kubectl apply -f ./hello-nodeport-svc.yaml
kubectl get service hello-svc

gcloud compute addresses create regional-loadbalancer --region=$REGION
gcloud compute addresses create global-ingress --global

kubectl create -f hello-v2.yaml
kubectl get deployments
export STATIC_LB=$(gcloud compute addresses describe regional-loadbalancer --region $REGION --format json | jq -r '.address')
sed -i "s/10\.10\.10\.10/$STATIC_LB/g" hello-lb-svc.yaml
kubectl apply -f ./hello-lb-svc.yaml

kubectl apply -f hello-ingress.yaml

#---WAIT FOR 5 MINUTES FOR LAB TO COMPLETE----
