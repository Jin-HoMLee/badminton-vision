#!/usr/bin/env python3
"""Create the intentionally tiny ONNX fixture used by the browser harness.

It is not a TrackNet model. The 1x1 convolution copies the red plane of each
of the three input frames into one output heatmap. This makes a known moving
peak for testing preprocessing, output decoding, temporal tags, and browser
execution providers without checking a model binary into the repository.
"""
import argparse
from pathlib import Path
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

parser = argparse.ArgumentParser()
parser.add_argument('--width', type=int, default=512)
parser.add_argument('--height', type=int, default=288)
parser.add_argument('--output', default='tracknet_fixture.onnx')
args = parser.parse_args()
out = Path(__file__).resolve().parents[1] / "fixtures" / args.output
out.parent.mkdir(parents=True, exist_ok=True)
weights = np.zeros((3, 9, 1, 1), dtype=np.float32)
weights[0, 0, 0, 0] = 1.0
weights[1, 3, 0, 0] = 1.0
weights[2, 6, 0, 0] = 1.0
bias = np.zeros((3,), dtype=np.float32)
input_info = helper.make_tensor_value_info("frames", TensorProto.FLOAT, [1, 9, args.height, args.width])
output_info = helper.make_tensor_value_info("heatmaps", TensorProto.FLOAT, [1, 3, args.height, args.width])
graph = helper.make_graph(
    [helper.make_node("Conv", ["frames", "weights", "bias"], ["heatmaps"], name="copy_red_planes", strides=[1, 1], dilations=[1, 1], pads=[0, 0, 0, 0])],
    "tracknet_browser_fixture",
    [input_info], [output_info],
    initializer=[numpy_helper.from_array(weights, "weights"), numpy_helper.from_array(bias, "bias")],
)
model = helper.make_model(graph, producer_name="tracknet-browser-spike", opset_imports=[helper.make_opsetid("", 13)])
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, out)
print(out)
