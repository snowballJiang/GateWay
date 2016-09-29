var express = require("express");
var httpProxy = require("http-proxy");
var zookeeper = require("node-zookeeper-client");
var cluster = require('cluster');
var os = require('os');

//zookeeper 服务器地址
var CONNECTION_STRING = '127.0.0.1:2181';
//约定好的zookeeper 查询的根节点
var REGISTER_ROOT = '/registry';

// 用于nodejs监控的端口号
var PORT = 2234;
var CPUS = os.cpus().length;

if (cluster.isMaster) {
    for (var i = 0; i < CPUS; i++) {
        cluster.fork();
    }
} else {

    //用于缓存
    var serviceNameCache = {};

//连接zookeeper
    var zk = zookeeper.createClient(CONNECTION_STRING);
    zk.connect();

//创建代理服务器进行监听
    var proxy = httpProxy.createProxyServer();
    proxy.on('error', function (error, req, res) {
        //输出空白页面
        res.end();
        return;
    });

    var app = express();
    app.use(express.static('public'));
    app.all('*', function (req, res) {
        //处理浏览器图标
        if (req.path == 'favicon.ico') {
            res.end();
            return;
        }

        //获取服务名称
        var serviceName = req.get('Service-Name');
        if (!serviceName) {
            console.log('servce-name request header is not exist');
            res.end();
            return;
        }

        //获取路径
        var servicePath = REGISTER_ROOT + '/' + serviceName;
        console.log('service path:%s', servicePath);

        //获取服务路径下的地址节点
        zk.getChildren(servicePath, function (error, addressNode) {
            if (error) {
                console.log(error);
                res.end();
                return;
            }
            // 服务下有几个节点
            var size = addressNode.length;
            if (size == 0) {
                console.log('address node is not exist');
                res.end();
                return;
            }
            //生成目标节点的路径
            var addressPath = servicePath + '/';

            //根据临时节点的个数，随机拿出一个服务的地址和端口号
            if (size == 1) {
                addressPath += addressNode[0];
            } else {
                addressPath += addressNode[parseInt(Math.random() * size)];
            }
            console.log('address path :%s', addressPath);

            if (serviceNameCache[serviceName]) {
                console.log(" 1.get Service Name from %d", serviceNameCache[serviceName]);
                //反向代理到目标服务器
                proxy.web(req, res, {target: 'http://' + serviceNameCache[serviceName]});
            } else {
                //发现临时节点有变化，就清空缓存
                zk.exists(servicePath, function (event) {
                    if (event.NODE_DELETED) {
                        //清空缓存
                        serviceNameCache = {};
                    }
                }, function (error, stat) {
                    if (stat) {
                        //获取服务器地址
                        zk.getData(addressPath, function (error, serviceAddress) {
                            if (error) {
                                console.log(error);
                                res.end();
                                return;
                            }
                            console.log('serviceAddress value:%s', serviceAddress);
                            if (!serviceAddress) {
                                console.log('serviceAddress value is null');
                                res.end();
                                return;
                            }
                            // serviceNameCache[serviceName] = serviceAddress;
                            //反向代理到目标服务器
                            proxy.web(req, res, {target: 'http://' + serviceAddress});
                        });
                    }
                });
            }
        });
    });

    app.listen(PORT, function () {
        console.log('server is running at %d', PORT);
    });
}