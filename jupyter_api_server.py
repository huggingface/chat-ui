from flask import Flask, request, jsonify
from jupyter import JupyterKernel, JupyterGatewayDocker

app = Flask("__main__")

@app.route("/execute", methods=["POST"])
def execute_code():
    data = request.get_json()
    print(data.get("convid"))
    print(data.get("code"))

    TO_EXEC = data.get("code").replace('\\n', '\n')

    with JupyterGatewayDocker() as url_suffix:
        # 1 kernel per convid
        j = JupyterKernel(url_suffix)
        print("--EXECUTE:")
        # try:
        print(j.execute(TO_EXEC))
        result = j.execute(TO_EXEC)
        # except Exception as e:
        #     print(e)
        
        del j
    return jsonify({"result": result})

if __name__ == "__main__":
    app.run(port=8080, debug=True)
